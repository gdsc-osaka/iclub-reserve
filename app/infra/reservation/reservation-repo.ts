import { and, eq, gt, lt, ne, notExists } from "drizzle-orm";
import type { RunnableQuery } from "drizzle-orm/runnable-query";
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

  /**
   * 変更**後**の施設・時間帯に、ほかの承認済みの予約が無いこと（COND-001）を確かめる条件。
   *
   * `noApprovedOverlap` は更新される行の列と突き合わせるが、UPDATE の WHERE が読むのは
   * **更新前**の値である。施設や日時を変える更新にそちらを使うと、動かす前の時間帯を確かめることになり、
   * 動かした先に承認済みの予約があっても通ってしまう。そこで、変更後の値を引数で受け取って突き合わせる。
   *
   * 自分自身は相手に数えない。承認済みの予約を少しずらすだけで、動かす前の自分と重なってしまうため。
   */
  const noApprovedOverlapAt = (
    slot: Pick<ReservationOverlapArgs, "facilityId" | "startAt" | "endAt">,
    selfId: string,
  ) =>
    notExists(
      db
        .select({ id: overlapping.id })
        .from(overlapping)
        .where(
          and(
            eq(overlapping.facilityId, slot.facilityId),
            eq(overlapping.status, ReservationStatus.Approved),
            ne(overlapping.id, selfId),
            lt(overlapping.startAt, slot.endAt),
            gt(overlapping.endAt, slot.startAt),
          ),
        ),
    );

  /**
   * 条件付きの UPDATE を実行し、実際に更新できたときだけ通知を outbox に積む（ADR-002 決定 3 / 課題 2.2）。
   *
   * UPDATE は競合したとき 0 件しか更新しないので、メールは「直前の UPDATE が書いた行」が
   * 実際にあるときだけ積ませる。同じ batch の中なので、条件には**更新後**の
   * status と updatedAt を渡す。仕組みは guardedMailOutboxInserts の JSDoc を参照。
   *
   * @param updateQuery 更新した行の id を返す（`.returning({ id })` 付きの）条件付き UPDATE
   * @param written 更新後の行を見分ける値
   * @param subject エラーの説明に入れる、何を書き込もうとしたか
   */
  const runGuardedUpdate = (
    updateQuery: RunnableQuery<{ id: string }[], "sqlite"> & PromiseLike<{ id: string }[]>,
    written: { readonly id: string; readonly status: ReservationStatus; readonly updatedAt: Date },
    mails: readonly MailDraft[],
    subject: string,
  ): ResultAsync<ApplyStatusTransitionOutcome, ReservationError> => {
    // メールが無い場合は batch を使わず UPDATE 単体で実行する（Drizzle の batch は空配列を受け付けないため）
    if (mails.length === 0) {
      return ResultAsync.fromPromise(updateQuery, (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: `${subject}を書き込めなかった。`,
        cause: error,
      })).map((rows) => ({
        applied: rows.length > 0,
        enqueuedMailIds: [],
      }));
    }

    const outbox = guardedMailOutboxInserts(db, mails, {
      from: reservationTable,
      where: and(
        eq(reservationTable.id, written.id),
        eq(reservationTable.status, written.status),
        eq(reservationTable.updatedAt, written.updatedAt),
      ),
    });

    return ResultAsync.fromPromise(
      db.batch([updateQuery, ...outbox.statements]),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: `${subject}と通知の outbox を書き込めなかった。`,
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

  const findById = (id: string): ResultAsync<Reservation, ReservationError> => {
    return ResultAsync.fromPromise(
      db.select().from(reservationTable).where(eq(reservationTable.id, id)).limit(1),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "予約テーブルを読み取れなかった。",
        cause: error,
      }),
    ).andThen((rows) => {
      const row = rows.at(0);

      if (row === undefined) {
        return err({
          code: ReservationErrorCode.NotFound,
          message: `予約 ${id} が見つからない。`,
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
      return ResultAsync.fromPromise(insertReservationQuery, (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "予約を書き込めなかった。",
        cause: error,
      })).map(() => ({ enqueuedMailIds: [] }));
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
        message: "予約と通知の outbox を書き込めなかった。",
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
            args.excludeReservationId === undefined
              ? undefined
              : ne(reservationTable.id, args.excludeReservationId),
            // 終了時刻は予約に含まれないので、境界がぴったり接する予約は重なりに含めない
            lt(reservationTable.startAt, args.endAt),
            gt(reservationTable.endAt, args.startAt),
          ),
        )
        .limit(1),
      (error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "承認済みの予約との重なりを読み取れなかった。",
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

    return runGuardedUpdate(updateQuery, args, mails, "予約のステータス");
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
      .where(
        and(
          eq(reservationTable.id, args.id),
          // 読んだときから変わっていないことを、更新の条件に入れる（ApplyContentEditArgs を参照）
          eq(reservationTable.status, args.expectedStatus),
          eq(reservationTable.updatedAt, args.expectedUpdatedAt),
          args.requireNoApprovedOverlap ? noApprovedOverlapAt(args, args.id) : undefined,
        ),
      )
      // 更新できたかを知るために、更新した行の id を返させる（0 件なら競合）
      .returning({ id: reservationTable.id });

    return runGuardedUpdate(updateQuery, args, mails, "予約の内容");
  };

  return { findById, create, existsApprovedOverlap, applyStatusTransition, applyContentEdit };
};
