/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { GroupAuditLogListQuery } from "~/query/audit-log/group-audit-log-list";
import type { GroupRecentActivitiesQuery } from "~/query/audit-log/group-recent-activities";
import type { ReservationAuditLogListQuery } from "~/query/audit-log/reservation-audit-log-list";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の GroupRecentActivitiesQuery の偽物を生成する。
 */
export function fakeGroupRecentActivitiesQuery(
  overrides: Partial<GroupRecentActivitiesQuery> = {},
): GroupRecentActivitiesQuery {
  return createUnimplementedFake("GroupRecentActivitiesQuery", overrides);
}

/**
 * テスト用の GroupAuditLogListQuery の偽物を生成する。
 */
export function fakeGroupAuditLogListQuery(
  overrides: Partial<GroupAuditLogListQuery> = {},
): GroupAuditLogListQuery {
  return createUnimplementedFake("GroupAuditLogListQuery", overrides);
}

/**
 * テスト用の ReservationAuditLogListQuery の偽物を生成する。
 */
export function fakeReservationAuditLogListQuery(
  overrides: Partial<ReservationAuditLogListQuery> = {},
): ReservationAuditLogListQuery {
  return createUnimplementedFake("ReservationAuditLogListQuery", overrides);
}
