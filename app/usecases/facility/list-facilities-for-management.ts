import { errAsync, type ResultAsync } from "neverthrow";

import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  FacilityManagementList,
  FacilityManagementListQuery,
} from "~/query/facility/facility-management-list";

export interface ListFacilitiesForManagementDeps {
  readonly facilityManagementListQuery: FacilityManagementListQuery;
}

export interface ListFacilitiesForManagementArgs {
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。施設管理一覧の閲覧は事務局限定 */
  readonly isStaff: boolean;
}

/**
 * 事務局向け施設管理一覧画面（SCR-009）のデータを取得するユースケース。
 *
 * 【認可と可視範囲】
 * 事務局スタッフ（isStaff: true）のみに許可する（COND-009）。
 * 一般利用者が開こうとした場合は、DB 問い合わせを行う前に即座に FORBIDDEN を返す。
 */
export const listFacilitiesForManagementUseCase = (
  deps: ListFacilitiesForManagementDeps,
  args: ListFacilitiesForManagementArgs,
): ResultAsync<FacilityManagementList, QueryError> => {
  if (!args.isStaff) {
    return errAsync({
      code: QueryErrorCode.Forbidden,
      message: "事務局ではないユーザーが施設管理一覧を開こうとした。",
    });
  }

  return deps.facilityManagementListQuery.listAll();
};
