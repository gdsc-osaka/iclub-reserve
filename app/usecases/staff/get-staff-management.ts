import { errAsync, type ResultAsync } from "neverthrow";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { StaffManagementQuery, StaffManagementView } from "~/query/staff/staff-management";

export interface GetStaffManagementDeps {
  readonly staffManagementQuery: StaffManagementQuery;
}

export interface GetStaffManagementArgs {
  readonly actorUserId: string;
  readonly isStaff: boolean;
}

/**
 * 事務局管理画面（SCR-019）のデータを取得するユースケース。
 *
 * 【認可と可視範囲】
 * 事務局スタッフ（isStaff: true）のみに許可する（COND-009）。
 * 一般利用者が開こうとした場合は、DB 問い合わせを行う前に即座に FORBIDDEN を返す。
 */
export const getStaffManagementUseCase = (
  deps: GetStaffManagementDeps,
  args: GetStaffManagementArgs,
): ResultAsync<StaffManagementView, QueryError> => {
  if (!args.isStaff) {
    return errAsync({
      code: QueryErrorCode.Forbidden,
      message: "事務局ではないユーザーが事務局管理画面を開こうとした。",
    });
  }

  return deps.staffManagementQuery.get();
};
