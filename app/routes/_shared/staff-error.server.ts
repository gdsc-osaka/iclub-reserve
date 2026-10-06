import { StaffErrorCode, staffErrorKind, type StaffError, type StaffField } from "~/domain/staff";

import {
  toActionErrors,
  toErrorResponse,
  type ActionErrors,
  type ErrorContext,
  type ErrorTables,
  type ErrorView,
} from "./error-response.server";

/**
 * 事務局管理まわりのエラーを、利用者にどう見せるかの表（ADR-004 決定 5）。
 *
 * 事務局管理を扱うすべての画面がこの 1 枚を使う。画面ごとに文言を書くと、
 * 同じ失敗が場所によって違う言い方で出てしまう。
 * `userMessage` を持つエラーは、`message` の代わりにそちらが出る（`toActionErrors` を参照）。
 */
export const staffErrorView: Record<StaffErrorCode, ErrorView> = {
  [StaffErrorCode.Forbidden]: { message: "この操作を行う権限がありません。" },
  [StaffErrorCode.InvalidInput]: { message: "入力内容を確認してください。" },
  /*
   * フォームで指した招待が無くなったため、画面を開いた後に状態が変わった（画面が古い）
   * という意味で既定の 404 を破って 409 にする。団体の INVITATION_GONE_IN_FORM と同じ考え方。
   * 404 のままにすると、action がこの画面ごとエラー画面に差し替えてしまう。
   */
  [StaffErrorCode.InvitationNotFound]: {
    status: 409,
    message: "対象の招待が見つかりませんでした。画面を読み込み直してください。",
  },
  /*
   * フォームで指したメンバーが無くなったため、画面を開いた後に状態が変わった（画面が古い）
   * という意味で既定の 404 を破って 409 にする。
   * 404 のままにすると、action がこの画面ごとエラー画面に差し替えてしまう。
   */
  [StaffErrorCode.MemberNotFound]: {
    status: 409,
    message: "対象の事務局メンバーが見つかりませんでした。画面を読み込み直してください。",
  },
  [StaffErrorCode.LastStaffRequired]: {
    message: "事務局が 0 人になるため、剥奪できません。先に別の人を事務局に招待してください。",
  },
  [StaffErrorCode.Conflict]: {
    message:
      "ほかの事務局の操作と重なったため、処理できませんでした。画面を読み込み直してください。",
  },
  [StaffErrorCode.DatabaseError]: {
    message: "処理を完了できませんでした。時間をおいて、もう一度お試しください。",
  },
};

const staffErrorTables: ErrorTables<StaffErrorCode> = {
  kindOf: staffErrorKind,
  viewOf: staffErrorView,
};

/**
 * 事務局管理のユースケースが失敗したときに、loader から投げる応答を作る。
 */
export const staffErrorResponse = (context: ErrorContext, error: StaffError) =>
  toErrorResponse(staffErrorTables, context, error);

/**
 * 事務局管理のユースケースが失敗したときに、action から画面へ返す誤りを作る。
 *
 * @param fieldOf ドメインの項目から、この画面の入力欄を引く表。欄が無い画面では省く
 */
export const staffActionErrors = <K extends string = never>(
  context: ErrorContext,
  error: StaffError,
  fieldOf?: Partial<Record<StaffField, K>>,
): ActionErrors<NoInfer<K>> => toActionErrors(staffErrorTables, context, error, fieldOf);
