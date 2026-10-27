import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { reservationMessageTable } from "~/db/schema";
import type { ReservationMessage } from "~/domain/reservation/message";

import type { Database } from "../db";

/**
 * reservation_message に書く 1 行ぶんの値。
 *
 * `$inferSelect` を使うことで、テーブルに列を足したときにコンパイルエラーにして漏れを防ぐ。
 */
type ReservationMessageValues = typeof reservationMessageTable.$inferSelect;

const reservationMessageColumns = getTableColumns(reservationMessageTable);

/**
 * 値 1 つを `INSERT ... SELECT` の 1 列ぶんの式にする。
 *
 * 値は `sql.param` に列を添えて渡す。Drizzle の列マッパーを通るので、
 * 日時（timestamp_ms）や真偽値の変換をここで手計算しなくて済む。
 * 別名も列の定義から取るため、snake_case を書き写して綴りを間違える余地が無い。
 */
const param = <K extends keyof ReservationMessageValues>(
  values: ReservationMessageValues,
  key: K,
) =>
  sql<ReservationMessageValues[K]>`${sql.param(values[key], reservationMessageColumns[key])}`.as(
    reservationMessageColumns[key].name,
  );

/**
 * `INSERT ... SELECT` の SELECT 側に並べる列。
 *
 * `INSERT ... SELECT` は列が**位置で**対応するため、並びは `reservation_message` の定義順に保つこと。
 */
const toReservationMessageProjection = (values: ReservationMessageValues) => ({
  id: param(values, "id"),
  reservationId: param(values, "reservationId"),
  senderId: param(values, "senderId"),
  sentAsStaff: param(values, "sentAsStaff"),
  body: param(values, "body"),
  sentAt: param(values, "sentAt"),
});

/** 条件付きで書くときに、「予約の更新が実際に書かれたか」を確かめる条件 */
export interface ReservationMessageGuard {
  /** 確かめる先の表（予約を書いた表） */
  readonly from: SQLiteTable;
  /**
   * 書き込み**後**の状態と突き合わせる条件。合う行が 1 件も無ければメッセージは書かれない。
   *
   * 省略できない。条件が無いと `guard.from` の行の数だけメッセージが入ってしまうため（`AuditLogGuard` と同じ）。
   */
  readonly where: SQL;
}

/**
 * 予約の条件付き更新が実際に書かれたときにだけメッセージを書く INSERT を組む（COND-023 / UC-038）。
 *
 * 解錠の手配の更新（UC-038）のように予約の条件付き UPDATE とメッセージ送信を同じ `db.batch()` に入れるとき、
 * 予約の更新が 0 件（競合で失敗）だったのにメッセージだけが残る（片方だけが残らないようにする。COND-023）のを防ぐため、
 * `guardedMailOutboxInserts` と同じく `INSERT ... SELECT ... FROM reservation WHERE <書き込み後の状態>` の形にする。
 *
 * `message` が null（メッセージを添えない）のときは空配列を返す。
 */
export const guardedReservationMessageInsert = (
  db: Database,
  message: ReservationMessage | null,
  guard: ReservationMessageGuard,
): readonly BatchItem<"sqlite">[] => {
  if (message === null) {
    return [];
  }

  const values: ReservationMessageValues = {
    id: message.id,
    reservationId: message.reservationId,
    senderId: message.senderId,
    sentAsStaff: message.sentAsStaff,
    body: message.body,
    sentAt: message.sentAt,
  };

  const statement = db
    .insert(reservationMessageTable)
    .select(db.select(toReservationMessageProjection(values)).from(guard.from).where(guard.where));

  return [statement];
};
