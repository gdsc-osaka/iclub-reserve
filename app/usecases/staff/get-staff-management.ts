import { errAsync, type ResultAsync } from "neverthrow";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { StaffManagementQuery, StaffManagementView } from "~/query/staff/staff-management";

export interface GetStaffManagementDeps {
  readonly staffManagementQuery: StaffManagementQuery;
}

export interface GetStaffManagementArgs {
  readonly actorUserId: string;
  readonly isStaff: boolean;
  /** 招待の期限切れを判定する基準の時刻 */
  readonly now: Date;
}

/**
 * 事務局管理画面（SCR-019）のデータを取得するユースケース。
 *
 * 【認可と可視範囲】
 * 事務局スタッフ（isStaff: true）のみに許可する（COND-009）。
 * 一般利用者が開こうとした場合は、DB 問い合わせを行う前に即座に FORBIDDEN を返す。
 *
 * 【承諾待ちの招待】
 * 期限切れは状態として持たず、承諾待ちのまま expires_at で判定する（STATE-003）。
 * 期限を過ぎた招待はもう承諾できないので、承諾待ちの一覧には出さない。
 * 団体管理画面（SCR-007、`getGroupManagementUseCase`）と同じ扱いにそろえる。
 * 団体の招待一覧（`GroupInvitationListQuery`）と同じく、問い合わせの窓口には基準の時刻を渡さず、
 * 絞り込みはここで行う。
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

  return deps.staffManagementQuery.get().map((view): StaffManagementView => ({
    ...view,
    pendingInvitations: view.pendingInvitations.filter(
      (invitation) => invitation.expiresAt.getTime() > args.now.getTime(),
    ),
  }));
};
