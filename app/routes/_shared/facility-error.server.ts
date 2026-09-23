import { FacilityErrorCode, facilityErrorKind, type FacilityError } from "~/domain/facility";

import {
  toErrorResponse,
  type ErrorContext,
  type ErrorTables,
  type ErrorView,
} from "./error-response.server";

/**
 * 施設まわりのエラーを、利用者にどう見せるかの表（ADR-004 決定 5）。
 *
 * 施設を扱うすべての画面がこの 1 枚を使う。画面ごとに文言を書くと、
 * 同じ失敗が場所によって違う言い方で出てしまう。
 */
export const facilityErrorView: Record<FacilityErrorCode, ErrorView> = {
  [FacilityErrorCode.NotFound]: { message: "施設・設備が見つかりません。" },
  [FacilityErrorCode.DatabaseError]: {
    message: "読み込めませんでした。時間をおいて、もう一度お試しください。",
  },
};

const facilityErrorTables: ErrorTables<FacilityErrorCode> = {
  kindOf: facilityErrorKind,
  viewOf: facilityErrorView,
};

/**
 * 施設のユースケースが失敗したときに、loader から投げる応答を作る。
 *
 * action 用の関数は、施設を書き換える画面ができたときに足すこと（`group-error.server.ts` と同じ形）。
 *
 * @example
 * throw facilityErrorResponse({ where: "facility.detail.loader", userId: user.id }, result.error);
 */
export const facilityErrorResponse = (context: ErrorContext, error: FacilityError) =>
  toErrorResponse(facilityErrorTables, context, error);
