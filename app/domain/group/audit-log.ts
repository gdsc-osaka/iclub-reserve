/**
 * 団体（INFO-003）の操作履歴に関する純粋関数と定数（COND-013）。
 */
import {
  AuditLogAction,
  toCreatedChanges,
  toUpdatedChanges,
  type AuditLogChanges,
} from "../audit-log";
import { GroupStatus } from "./index";

/**
 * 団体の有効化・無効化に対応する操作（VAR-002）。
 */
export const groupStatusAuditLogAction: Record<
  typeof GroupStatus.Enabled | typeof GroupStatus.Disabled,
  AuditLogAction
> = {
  [GroupStatus.Enabled]: AuditLogAction.GroupEnable,
  [GroupStatus.Disabled]: AuditLogAction.GroupDisable,
};

/**
 * 団体の作成（UC-010 / #11）の変更内容を組み立てる。
 */
export const toGroupCreatedChanges = (group: {
  readonly name: string;
  readonly status: GroupStatus;
}): AuditLogChanges =>
  toCreatedChanges({
    name: group.name,
    status: group.status,
  });

/**
 * 団体名の変更（UC-013 / #12）の変更内容を組み立てる。
 */
export const toGroupNameUpdatedChanges = (before: string, after: string): AuditLogChanges =>
  toUpdatedChanges({ name: before }, { name: after });

/**
 * 団体の状態変更（UC-014 / #13・#14）の変更内容を組み立てる。
 */
export const toGroupStatusChanges = (before: GroupStatus, after: GroupStatus): AuditLogChanges =>
  toUpdatedChanges({ status: before }, { status: after });
