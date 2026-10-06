import { err, ok, type Result } from "neverthrow";
import { canAct } from "~/domain/membership";
import { StaffAction, StaffErrorCode, staffPermissions, type StaffError } from "~/domain/staff";

/**
 * 事務局管理の操作権限を確かめる門番（COND-009）。
 *
 * 事務局の管理（一覧・招待・招待取り消し・剥奪）は事務局スタッフのみに許可される。
 */
export const ensureStaffPermission = (
  actor: { readonly isStaff: boolean },
  action: StaffAction,
): Result<null, StaffError> =>
  canAct(staffPermissions, { isStaff: actor.isStaff, membership: null }, action)
    ? ok(null)
    : err({
        code: StaffErrorCode.Forbidden,
        message: `事務局ではないユーザーが事務局管理操作 ${action} を試みた。`,
        userMessage: "事務局の管理は事務局のみが行えます。",
      });
