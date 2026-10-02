import { err, ok, type Result } from "neverthrow";
import {
  FacilityAction,
  FacilityErrorCode,
  facilityPermissions,
  type FacilityError,
} from "~/domain/facility";
import { canAct } from "~/domain/membership";

/**
 * 施設管理の操作権限を確かめる門番（COND-009）。
 *
 * 施設・設備の管理（一覧・登録・編集・有効化/無効化）は事務局スタッフのみに許可される。
 * 施設情報は存在秘匿（COND-011）の対象ではないため、NotVisible に潰さず Forbidden を返す。
 */
export const ensureFacilityPermission = (
  actor: { readonly isStaff: boolean },
  action: FacilityAction,
): Result<null, FacilityError> =>
  canAct(facilityPermissions, { isStaff: actor.isStaff, membership: null }, action)
    ? ok(null)
    : err({
        code: FacilityErrorCode.Forbidden,
        message: `事務局ではないユーザーが施設操作 ${action} を試みた。`,
        userMessage: "施設の管理は事務局のみが行えます。",
      });
