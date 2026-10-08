/**
 * 施設・設備（INFO-002）の操作履歴に関する純粋関数（COND-013）。
 */
import {
  AuditLogAction,
  toCreatedChanges,
  toUpdatedChanges,
  type AuditLogChanges,
} from "../audit-log";

/**
 * 施設登録（UC-015 / #21）の変更内容を組み立てる。
 */
export const toFacilityCreateChanges = (input: {
  readonly name: string;
  readonly description: string | null;
  readonly photoUrl: string | null;
  readonly googleCalendarId: string | null;
  readonly calendarUrl: string | null;
  readonly isActive: boolean;
}): AuditLogChanges =>
  toCreatedChanges({
    name: input.name,
    description: input.description,
    photo_url: input.photoUrl,
    google_calendar_id: input.googleCalendarId,
    calendar_url: input.calendarUrl,
    is_active: input.isActive,
  });

/**
 * 施設更新（UC-015 / #22）の変更内容を組み立てる。
 * 変わった項目だけを残す。
 */
export const toFacilityUpdateChanges = (
  before: {
    readonly name: string;
    readonly description: string | null;
    readonly photoUrl: string | null;
    readonly googleCalendarId: string | null;
    readonly calendarUrl: string | null;
  },
  after: {
    readonly name: string;
    readonly description: string | null;
    readonly photoUrl: string | null;
    readonly googleCalendarId: string | null;
    readonly calendarUrl: string | null;
  },
): AuditLogChanges =>
  toUpdatedChanges(
    {
      name: before.name,
      description: before.description,
      photo_url: before.photoUrl,
      google_calendar_id: before.googleCalendarId,
      calendar_url: before.calendarUrl,
    },
    {
      name: after.name,
      description: after.description,
      photo_url: after.photoUrl,
      google_calendar_id: after.googleCalendarId,
      calendar_url: after.calendarUrl,
    },
  );

/**
 * 有効化・無効化の操作種別を返す（UC-016 / #23, #24）。
 */
export const facilityStatusAuditLogAction: Record<"active" | "inactive", AuditLogAction> = {
  active: AuditLogAction.FacilityReactivate,
  inactive: AuditLogAction.FacilityDeactivate,
};

export const toFacilityStatusAction = (targetIsActive: boolean): AuditLogAction =>
  targetIsActive ? facilityStatusAuditLogAction.active : facilityStatusAuditLogAction.inactive;

/**
 * 施設有効化・無効化（UC-016 / #23, #24）の変更内容を組み立てる。
 */
export const toFacilityStatusChanges = (before: boolean, after: boolean): AuditLogChanges =>
  toUpdatedChanges({ is_active: before }, { is_active: after });
