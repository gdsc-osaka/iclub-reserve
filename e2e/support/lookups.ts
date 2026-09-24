import { eq } from "drizzle-orm";
import { reservationTable } from "~/db/schema";
import type { E2eDb } from "./db.js";

/**
 * 画面の操作でできたデータを DB から探す。
 *
 * 画面で作った予約の ID は、画面からは読み取りにくい。
 * 通知のメールなど、ID で結び付けて確かめたいときに使う。
 */

/** ある施設の予約をすべて読む。予約を作るテストは施設もテストごとに作るので、その施設の予約だけが返る */
export async function findReservationsOfFacility(db: E2eDb, facilityId: string) {
  return db.select().from(reservationTable).where(eq(reservationTable.facilityId, facilityId));
}
