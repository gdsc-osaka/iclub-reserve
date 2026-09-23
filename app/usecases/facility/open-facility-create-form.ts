import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import { FacilityAction, type FacilityError } from "~/domain/facility";
import { ensureFacilityPermission } from "./_shared/facility-authorization";

/** このユースケースへの入力 */
export interface OpenFacilityCreateFormArgs {
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。施設の登録は事務局限定 */
  readonly isStaff: boolean;
}

/**
 * 施設の登録画面（SCR-009）を開いてよいかを確かめるユースケース。
 *
 * 登録画面は読み込むデータを持たないが、事務局でない人には画面ごと見せない。
 * 権限の判定をルートに書き写さないよう、登録（`createFacilityUseCase`）と同じ門番を通す。
 */
export const openFacilityCreateFormUseCase = (
  args: OpenFacilityCreateFormArgs,
): ResultAsync<null, FacilityError> => {
  const permissionResult = ensureFacilityPermission(
    { isStaff: args.isStaff },
    FacilityAction.Create,
  );

  return permissionResult.isErr() ? errAsync(permissionResult.error) : okAsync(null);
};
