import { errAsync, type ResultAsync } from "neverthrow";

import {
  FacilityAction,
  FacilityErrorCode,
  type Facility,
  type FacilityError,
  type FacilityRepository,
} from "~/domain/facility";
import { ensureFacilityPermission } from "./_shared/facility-authorization";

/** このユースケースが必要とする依存 */
export interface GetFacilityDeps {
  readonly facilityRepository: FacilityRepository;
}

/** このユースケースへの入力 */
export interface GetFacilityArgs {
  readonly facilityId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。施設詳細・編集画面の閲覧は事務局限定 */
  readonly isStaff: boolean;
}

/**
 * 施設 ID を指定して、その施設・設備の情報を 1 件取得するユースケース。
 *
 * 【認可と可視範囲】
 * 事務局スタッフのみ閲覧可能（COND-009）。
 * 施設を引く前に ensureFacilityPermission(ViewManagement) を通す。
 */
export const getFacilityUseCase = (
  deps: GetFacilityDeps,
  args: GetFacilityArgs,
): ResultAsync<Facility, FacilityError> => {
  const permissionResult = ensureFacilityPermission(
    { isStaff: args.isStaff },
    FacilityAction.ViewManagement,
  );
  if (permissionResult.isErr()) {
    return errAsync(permissionResult.error);
  }

  const id = args.facilityId.trim();

  // 空文字や空白だけの ID は DB へ問い合わせるまでもないので、ここで打ち切る
  if (id === "") {
    return errAsync({
      code: FacilityErrorCode.NotFound,
      message: "施設 ID が空である。",
    });
  }

  return deps.facilityRepository.findById(id);
};
