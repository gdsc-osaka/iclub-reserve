import { and, eq, gt, lt, ne, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { err, ok, ResultAsync } from "neverthrow";

import { reservationTable } from "~/db/schema";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import {
  ReservationErrorCode,
  ReservationStatus,
  type ApplyContentEditArgs,
  type ApplyContentEditOutcome,
  type ApplyStatusTransitionArgs,
  type ApplyStatusTransitionOutcome,
  type CreateReservationOutcome,
  type Reservation,
  type ReservationError,
  type ReservationOverlapArgs,
  type ReservationRepository,
} from "~/domain/reservation";
import type { Database } from "../db";
import { guardedMailOutboxInserts, mailOutboxInserts } from "../mail/mail-outbox-writes";

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

  const create = (
    reservation: Reservation,
    mails: readonly MailDraft[],
  ): ResultAsync<CreateReservationOutcome, ReservationError> => {
    const insertReservationQuery = db.insert(reservationTable).values(reservation);

    // メールが無い場合は batch を使わず INSERT 単体で実行する（Drizzle の batch は空配列を受け付けないため）
    if (mails.length === 0) {
      return ResultAsync.fromPromise(
        insertReservationQuery,
        (error): ReservationError => ({
          code: ReservationErrorCode.DatabaseError,
          message: "予約の作成に失敗しました。",
          cause: error,
        }),
      ).map(() => ({ enqueuedMailIds: [] }));
    }

    /*
     * 予約の INSERT と outbox への INSERT を原子的に行う（ADR-002 決定 3）。
     *
     * `applyStatusTransition` と違って条件付きの書き込みが無いので、
     * 「業務データが実際に書かれたか」を確かめる必要はない。予約の INSERT が失敗すれば
     * batch ごと巻き戻り、メールも積まれない。
     */
    const outbox = mailOutboxInserts(db, mails);

    return ResultAsync.fromPromise(
      db.batch([insertReservationQuery, ...outbox.statements]),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "予約の作成および通知 outbox の作成に失敗しました。",
        cause: error,
      }),
    ).map(() => ({
      enqueuedMailIds: outbox.ids,
    }));
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
      return ResultAsync.fromPromise(
        updateQuery,
        (error): ReservationError => ({
          code: ReservationErrorCode.DatabaseError,
          message: "予約ステータスの更新に失敗しました。",
          cause: error,
        }),
      ).map((rows) => ({
        applied: rows.length > 0,
        enqueuedMailIds: [],
      }));
    }

    /*
     * 条件付き UPDATE と outbox への INSERT を原子的に行う（ADR-002 決定 3 / 課題 2.2）。
     *
     * UPDATE は競合したとき 0 件しか更新しないので、メールは「直前の UPDATE が書いた行」が
     * 実際にあるときだけ積ませる。同じ batch の中なので、条件には**更新後**の
     * status と updatedAt を渡す。仕組みは guardedMailOutboxInserts の JSDoc を参照。
     */
    const outbox = guardedMailOutboxInserts(db, mails, {
      from: reservationTable,
      where: and(
        eq(reservationTable.id, args.id),
        eq(reservationTable.status, args.status),
        eq(reservationTable.updatedAt, args.updatedAt),
      ),
    });

    return ResultAsync.fromPromise(
      db.batch([updateQuery, ...outbox.statements]),
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
        enqueuedMailIds: applied ? outbox.ids : [],
      };
    });
  };

  const applyContentEdit = (
    args: ApplyContentEditArgs,
    mails: readonly MailDraft[],
  ): ResultAsync<ApplyContentEditOutcome, ReservationError> => {
    const updateQuery = db
      .update(reservationTable)
      .set({
        facilityId: args.facilityId,
        startAt: args.startAt,
        endAt: args.endAt,
        headCount: args.headCount,
        note: args.note,
        status: args.status,
        updatedAt: args.updatedAt,
      })
      .where(and(eq(reservationTable.id, args.id), noApprovedOverlap))
      .returning({ id: reservationTable.id });

    if (mails.length === 0) {
      return ResultAsync.fromPromise(
        updateQuery,
        (error): ReservationError => ({
          code: ReservationErrorCode.DatabaseError,
          message: "予約ステータスの更新に失敗しました。",
          cause: error,
        }),
      ).map((rows) => ({
        applied: rows.length > 0,
        enqueuedMailIds: [],
      }));
    }

    const outbox = guardedMailOutboxInserts(db, mails, {
      from: reservationTable,
      where: and(
        eq(reservationTable.id, args.id),
        eq(reservationTable.status, args.status),
        eq(reservationTable.updatedAt, args.updatedAt),
      ),
    });

    return ResultAsync.fromPromise(
      db.batch([updateQuery, ...outbox.statements]),
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
        enqueuedMailIds: applied ? outbox.ids : [],
      };
    });
  };

  return { findById, create, existsApprovedOverlap, applyStatusTransition, applyContentEdit };
};
