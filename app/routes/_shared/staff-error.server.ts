import { StaffErrorCode, staffErrorKind, type StaffError, type StaffField } from "~/domain/staff";

import {
  toActionErrors,
  toErrorResponse,
  type ActionErrors,
  type ErrorContext,
  type ErrorTables,
  type ErrorView,
} from "./error-response.server";
import { invitationNotFoundView, invitationNotVisibleView } from "./invitation-error-view.server";

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
   * InvitationNotVisible もこの行にする。事務局管理画面（SCR-019）の操作では起きない（宛先を確かめるのは承諾画面だけ）が、
   * 表は網羅が要るので、起きたときにも同じ案内になるようにしておく。
   */
  [StaffErrorCode.InvitationNotVisible]: {
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

/**
 * 事務局招待の承諾画面（SCR-020）で使う表。招待の 2 行だけが `staffErrorView` と違う。
 *
 * この画面では、招待は URL が指すもの（画面そのもの）である。無ければ画面ごと 404 にする。
 * 事務局管理画面（SCR-019）では招待をフォームで指すので 409 にしており、同じコードでも見せ方が変わる。
 *
 * どちらの行も 404 なので、action でも返さずに投げる。投げる応答は表の文言だけを使うので、
 * 宛先違いに誰かが `userMessage` を書いても応答は変わらない。
 */
export const staffInvitationErrorView: Record<StaffErrorCode, ErrorView> = {
  ...staffErrorView,
  [StaffErrorCode.InvitationNotFound]: invitationNotFoundView,
  // COND-015: 宛先が違うことを「無い」として答える。既定の 403 を意図的に破っている
  [StaffErrorCode.InvitationNotVisible]: invitationNotVisibleView,
};

const staffInvitationErrorTables: ErrorTables<StaffErrorCode> = {
  kindOf: staffErrorKind,
  viewOf: staffInvitationErrorView,
};

/**
 * 事務局招待の承諾画面で、ユースケースが失敗したときに loader から投げる応答を作る。
 *
 * 宛先が本人ではない招待も、無い招待と同じ 404 になる。
 */
export const staffInvitationErrorResponse = (context: ErrorContext, error: StaffError) =>
  toErrorResponse(staffInvitationErrorTables, context, error);

/**
 * 事務局招待の承諾画面で、ユースケースが失敗したときに action から画面へ返す誤りを作る。
 *
 * 招待が無い・宛先が違うときは、返さずに loader と同じ 404 を投げる。
 * この画面には入力欄が無いので、誤りはすべてフォームの上に出る。
 */
export const staffInvitationActionErrors = (
  context: ErrorContext,
  error: StaffError,
): ActionErrors<never> => toActionErrors(staffInvitationErrorTables, context, error);
