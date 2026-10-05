import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "../../app/db/schema/index.js";
import {
  seedAuditLogs,
  seedFacilities,
  seedGroupInvitations,
  seedGroupMembers,
  seedGroups,
  seedReservations,
  seedUsers,
} from "./seed-data.js";

/**
 * ローカルの DB にシードデータを入れる。
 *
 * `pnpm run db:seed`（開発用の DB）と E2E テストの準備（`e2e/prepare.ts`）の両方から呼ぶ。
 * 入れる順番は外部キーの向きに合わせてある（団体より先に利用者、予約より先に施設と団体）。
 * すでにある行は上書きせずに飛ばす。
 *
 * @param log 進み具合を出す先。E2E の準備では出さない。
 */
export async function insertSeedData(
  db: BetterSQLite3Database<typeof schema>,
  log: (message: string) => void = () => {},
): Promise<void> {
  log("1/7 施設・備品データを投入中...");
  await db.insert(schema.facilityTable).values(seedFacilities).onConflictDoNothing();

  log("2/7 テストユーザーデータを投入中...");
  await db.insert(schema.user).values(seedUsers).onConflictDoNothing();

  log("3/7 団体データを投入中...");
  await db.insert(schema.groupTable).values(seedGroups).onConflictDoNothing();

  log("4/7 団体メンバーシップデータを投入中...");
  await db.insert(schema.groupMemberTable).values(seedGroupMembers).onConflictDoNothing();

  log("5/7 招待データを投入中...");
  await db.insert(schema.groupInvitationTable).values(seedGroupInvitations).onConflictDoNothing();

  log("6/7 サンプル予約データを投入中...");
  await db.insert(schema.reservationTable).values(seedReservations).onConflictDoNothing();

  log("7/7 操作履歴データを投入中...");
  await db.insert(schema.auditLogTable).values(seedAuditLogs).onConflictDoNothing();
}
