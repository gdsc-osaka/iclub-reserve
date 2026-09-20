import { and, eq, gt, lt, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { err, ok, ResultAsync } from "neverthrow";

import { mailOutboxTable, reservationTable } from "~/db/schema";
import { MailOutboxStatus, type MailDraft } from "~/domain/mail/mail-outbox";
import {
  ReservationErrorCode,
  ReservationStatus,
  type ApplyStatusTransitionArgs,
  type ApplyStatusTransitionOutcome,
  type Reservation,
  type ReservationError,
  type ReservationOverlapArgs,
  type ReservationRepository,
} from "~/domain/reservation";
import type { Database } from "../db";

/** 重なりを探すとき、同じ予約テーブルをもう一度読むための別名 */
const overlapping = alias(reservationTable, "overlapping");

export const createReservationRepository = (db: Database): ReservationRepository => {
  /**
   * 承認済みの予約と重なっていないこと（COND-001）を、更新する行自身と突き合わせる条件。
   *
   * `existsApprovedOverlap` と違い、時間帯を引数で受けずに更新対象の行の列を参照する。
   * こうすることで「重なりの確認」と「ステータスの更新」が 1 つの UPDATE 文になり、
   * 2 人の事務局が重なった仮予約を同時に承認しても、あとの 1 件が 0 件更新で弾かれる。
   *
   * 外側（更新される行）は reservationTable、内側（重なりを探す側）は overlapping と、
   * 同じ表を 2 つの名前で参照する。列はどちらも Drizzle の定義から辿るので、
   * 列名を変えたときは SQL ではなく型エラーとして分かる。
   */
  const noApprovedOverlap = notExists(
    db
      .select({ id: overlapping.id })
      .from(overlapping)
      .where(
        and(
          eq(overlapping.facilityId, reservationTable.facilityId),
          eq(overlapping.status, ReservationStatus.Approved),
          ne(overlapping.id, reservationTable.id),
          // 終了時刻は予約に含まれないので、境界がぴったり接する予約は重なりに含めない
          lt(overlapping.startAt, reservationTable.endAt),
          gt(overlapping.endAt, reservationTable.startAt),
        ),
      ),
  );

  const findById = (id: string): ResultAsync<Reservation, ReservationError> => {
    return ResultAsync.fromPromise(
      db.select().from(reservationTable).where(eq(reservationTable.id, id)).limit(1),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "Failed to query the database",
        cause: error,
      }),
    ).andThen((rows) => {
      const row = rows.at(0);

      if (row === undefined) {
        return err({
          code: ReservationErrorCode.ReservationNotFound,
          message: "Reservation not Found",
        });
      }

      return ok(row);
    });
  };

  const create = (reservation: Reservation): ResultAsync<null, ReservationError> => {
    return ResultAsync.fromPromise(
      db.insert(reservationTable).values(reservation),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "Failed to insert reservation",
        cause: error,
      }),
    ).map(() => null);
  };

  /**
   * 重なっている承認済みの予約を 1 件だけ探す（COND-001）。
   *
   * 件数は要らないので `limit(1)` で打ち切る。重複が 1 件でもあれば申請を止めるため、
   * 何件あるかを数えても使い道がない。
   */
  const existsApprovedOverlap = (
    args: ReservationOverlapArgs,
  ): ResultAsync<boolean, ReservationError> =>
    ResultAsync.fromPromise(
      db
        .select({ id: reservationTable.id })
        .from(reservationTable)
        .where(
          and(
            eq(reservationTable.facilityId, args.facilityId),
            eq(reservationTable.status, ReservationStatus.Approved),
            // 終了時刻は予約に含まれないので、境界がぴったり接する予約は重なりに含めない
            lt(reservationTable.startAt, args.endAt),
            gt(reservationTable.endAt, args.startAt),
          ),
        )
        .limit(1),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "重複する予約の確認に失敗しました。",
        cause: error,
      }),
    ).map((rows) => rows.length > 0);

  const applyStatusTransition = (
    args: ApplyStatusTransitionArgs,
    mails: readonly MailDraft[],
  ): ResultAsync<ApplyStatusTransitionOutcome, ReservationError> => {
    const updateQuery = db
      .update(reservationTable)
      .set({
        status: args.status,
        statusReason: args.statusReason,
        updatedAt: args.updatedAt,
      })
      .where(
        and(
          eq(reservationTable.id, args.id),
          // 読んだときの状態から変わっていないことを、更新の条件に入れる
          eq(reservationTable.status, args.expectedStatus),
          args.requireNoApprovedOverlap ? noApprovedOverlap : undefined,
        ),
      )
      // 更新できたかを知るために、更新した行の id を返させる（0 件なら競合）
      .returning({ id: reservationTable.id });

    // メールが無い場合は batch を使わず UPDATE 単体で実行する（Drizzle の batch は空配列を受け付けないため）
    if (mails.length === 0) {
      return ResultAsync.fromPromise(updateQuery, (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "予約ステータスの更新に失敗しました。",
        cause: error,
      })).map((rows) => ({
        applied: rows.length > 0,
        enqueuedMailIds: [],
      }));
    }

    /*
     * 条件付き UPDATE と outbox への INSERT を原子的に行う（ADR-002 決定 3 / 課題 2.2）。
     *
     * db.batch() は中の文を無条件に全部実行するため、単純に batch([update, insert]) と書くと、
     * UPDATE が 0 件（競合で承認失敗）でも「承認されました」メールが outbox に積まれてしまう。
     *
     * これを防ぐため、INSERT ... SELECT ... FROM reservation WHERE ... の形にし、
     * 「直前の UPDATE で書き換えた行（id・更新後 status・更新後 updatedAt が一致する行）」が
     * 実際に存在するときだけ 1 行入るようにする。
     *
     * また、ON CONFLICT (idempotency_key) DO NOTHING を付けることで、重複操作時にも
     * batch 全体がロールバックされて承認まで巻き戻るのを防ぐ。
     *
     * SELECT は SQL 文字列ではなく Drizzle のクエリビルダで組み立てる。列を
     * mailOutboxTable のキーで書けるので綴りの誤りは型エラーになり、並びが表の定義と
     * ずれていれば Drizzle が実行前に例外で止める（生の SQL 文字列では誰も検査しない）。
     * そのため、列は既定値のあるものも省略せず、schema の定義順どおりに並べること。
     */
    const now = new Date();
    const mailIds: string[] = [];

    const insertQueries = mails.map((mail) => {
      const mailId = createId();
      mailIds.push(mailId);

      return db
        .insert(mailOutboxTable)
        .select(
          db
            .select({
              id: sql<string>`${mailId}`.as("id"),
              idempotencyKey: sql<string>`${mail.idempotencyKey}`.as("idempotency_key"),
              toAddress: sql<string>`${mail.to.address}`.as("to_address"),
              toName: sql<string | null>`${mail.to.name ?? null}`.as("to_name"),
              subject: sql<string>`${mail.subject}`.as("subject"),
              bodyText: sql<string>`${mail.text}`.as("body_text"),
              bodyHtml: sql<string | null>`${mail.html ?? null}`.as("body_html"),
              status: sql<MailOutboxStatus>`${MailOutboxStatus.Pending}`.as("status"),
              attemptCount: sql<number>`0`.as("attempt_count"),
              // 日時は列のマッパーを通して Date をミリ秒へ変換させる（手計算した値を入れない）
              nextAttemptAt: sql`${sql.param(now, mailOutboxTable.nextAttemptAt)}`.as(
                "next_attempt_at",
              ),
              lastError: sql<string | null>`${null}`.as("last_error"),
              createdAt: sql`${sql.param(now, mailOutboxTable.createdAt)}`.as("created_at"),
              updatedAt: sql`${sql.param(now, mailOutboxTable.updatedAt)}`.as("updated_at"),
            })
            .from(reservationTable)
            .where(
              and(
                eq(reservationTable.id, args.id),
                eq(reservationTable.status, args.status),
                eq(reservationTable.updatedAt, args.updatedAt),
              ),
            ),
        )
        .onConflictDoNothing({ target: mailOutboxTable.idempotencyKey });
    });

    return ResultAsync.fromPromise(
      db.batch([updateQuery, ...insertQueries]),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "予約ステータスの更新および通知 outbox の作成に失敗しました。",
        cause: error,
      }),
    ).map((results) => {
      const updateRows = results[0] as { id: string }[];
      const applied = updateRows.length > 0;
      return {
        applied,
        enqueuedMailIds: applied ? mailIds : [],
      };
    });
  };

  return { findById, create, existsApprovedOverlap, applyStatusTransition };
};
