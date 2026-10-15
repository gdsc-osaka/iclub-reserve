import { errAsync, type ResultAsync } from "neverthrow";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  StaffTodayScheduleQuery,
  StaffTodayScheduleResult,
} from "~/query/reservation/staff-today-schedule";

export interface GetStaffTodayScheduleDeps {
  readonly staffTodayScheduleQuery: StaffTodayScheduleQuery;
}

export interface GetStaffTodayScheduleArgs {
  readonly isStaff: boolean;
  readonly now: Date;
}

/**
 * 事務局のダッシュボードの「今日の予約状況」を取得する（UC-001 / SCR-022）。
 */
export const getStaffTodayScheduleUseCase = (
  deps: GetStaffTodayScheduleDeps,
  args: GetStaffTodayScheduleArgs,
): ResultAsync<StaffTodayScheduleResult, QueryError> => {
  if (!args.isStaff) {
    return errAsync({
      code: QueryErrorCode.Forbidden,
      message: "事務局ではない人が、今日の予約状況を取得しようとした。",
    });
  }

  return deps.staffTodayScheduleQuery.findTodaySchedule(args.now);
};
