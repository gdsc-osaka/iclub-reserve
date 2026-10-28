import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { reservationMessageTable } from "~/db/schema";
import type { ReservationMessage } from "~/domain/reservation/message";

import type { Database } from "../db";

/**
 * reservation_message に書く 1 行ぶんの値。
 *
 * `$inferSelect` を使っているのは、`reservation_message` に列を足したときに
 * `toReservationMessageValues` を**コンパイルエラーにして**写し忘れを防ぐため。
 */
type ReservationMessageValues = typeof reservationMessageTable.$inferSelect;

const reservationMessageColumns = getTableColumns(reservationMessageTable);

/** `ReservationMessage` を `reservation_message` の 1 行に写す */
const toReservationMessageValues = (message: ReservationMessage): ReservationMessageValues => ({
  id: message.id,
  reservationId: message.reservationId,
  senderId: message.senderId,
  sentAsStaff: message.sentAsStaff,
  body: message.body,
  sentAt: message.sentAt,
});

/**
 * 値 1 つを `INSERT ... SELECT` の 1 列ぶんの式にする。
 *
 * 列の定義を渡して Drizzle の変換を通すので、boolean や日時（timestamp_ms）の変換をここで書かなくて済む。
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
 * `INSERT ... SELECT` は列が**位置で**対応するため、並びは `reservationMessageTable` の定義順に保つこと。
 */
const toReservationMessageProjection = (values: ReservationMessageValues) => ({
  id: param(values, "id"),
  reservationId: param(values, "reservationId"),
  senderId: param(values, "senderId"),
  sentAsStaff: param(values, "sentAsStaff"),
  body: param(values, "body"),
  sentAt: param(values, "sentAt"),
});

/** 条件付きで書くときに、「業務データが実際に書かれたか」を確かめる条件 */
export interface ReservationMessageGuard {
  /** 確かめる先の表（業務データを書いた表） */
  readonly from: SQLiteTable;
  /** 書き込み**後**の状態と突き合わせる条件。合う行が無ければメッセージは書かれない */
  readonly where: SQL | undefined;
}

/**
 * 予約の操作が実際に書かれたときにだけ、同時に送るメッセージを書く INSERT を組む（COND-023）。
 *
 * 仮予約の承認（UC-006）や解錠の手配の更新（UC-038）と同時に送るメッセージに使う。
 * 予約の更新は条件付きで、競合すると 0 件になる。`db.batch()` は中の文を無条件に全部実行するので、
 * 素直に INSERT を並べると、承認されていないのにメッセージだけが残ってしまう。
 * そこで outbox（`guardedMailOutboxInserts`）と同じく `INSERT ... SELECT ... FROM <業務の表> WHERE <書き込み後の状態>`
 * の形にし、直前の更新が書いた行があるときだけ 1 行を書く。
 *
 * message が null なら何も書かない（空配列を返す）。
 */
export const guardedReservationMessageInserts = (
  db: Database,
  message: ReservationMessage | null,
  guard: ReservationMessageGuard,
): readonly BatchItem<"sqlite">[] => {
  if (message === null) {
    return [];
  }

  const values = toReservationMessageValues(message);

  return [
    db
      .insert(reservationMessageTable)
      .select(
        db.select(toReservationMessageProjection(values)).from(guard.from).where(guard.where),
      ),
  ];
};
