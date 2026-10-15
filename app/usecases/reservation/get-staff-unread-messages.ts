import { errAsync, type ResultAsync } from "neverthrow";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  StaffUnreadMessagesQuery,
  StaffUnreadMessagesResult,
} from "~/query/reservation/staff-unread-messages";

export interface GetStaffUnreadMessagesDeps {
  readonly staffUnreadMessagesQuery: StaffUnreadMessagesQuery;
}

export interface GetStaffUnreadMessagesArgs {
  readonly actorUserId: string;
  readonly isStaff: boolean;
  readonly now: Date;
}

/**
 * 事務局側のダッシュボード「団体からの未読メッセージ」を取得するユースケース（UC-037 / COND-026 (3)）。
 */
export const getStaffUnreadMessagesUseCase = (
  deps: GetStaffUnreadMessagesDeps,
  args: GetStaffUnreadMessagesArgs,
): ResultAsync<StaffUnreadMessagesResult, QueryError> => {
  if (!args.isStaff) {
    return errAsync({
      code: QueryErrorCode.Forbidden,
      message: "事務局ではない人が、事務局向けの未読メッセージを取得しようとした。",
    });
  }

  return deps.staffUnreadMessagesQuery.findUnreadForStaff(args.actorUserId, args.now);
};
