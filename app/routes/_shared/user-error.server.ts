import { UserErrorCode, userErrorKind, type UserError } from "~/domain/user";

import {
  toActionErrors,
  toErrorResponse,
  type ActionErrors,
  type ErrorContext,
  type ErrorTables,
  type ErrorView,
} from "./error-response.server";

/**
 * ユーザーまわりのエラーを、利用者にどう見せるかの表（ADR-004 決定 5）。
 *
 * ユーザーを扱うすべての画面がこの 1 枚を使う。
 * 表は Partial にせず、UserErrorCode を網羅する。
 */
export const userErrorView: Record<UserErrorCode, ErrorView> = {
  [UserErrorCode.NotFound]: { message: "ユーザーが見つかりません。" },
  [UserErrorCode.DatabaseError]: {
    message: "保存できませんでした。時間をおいて、もう一度お試しください。",
  },
  /*
   * 画面を開いた後に別の端末でログアウトされた、または他人のセッションを指定した。
   * フォームで指したものが無くなったという意味で 409 にする（ADR-004 決定 7）。
   */
  [UserErrorCode.SessionNotFound]: {
    status: 409,
    message: "対象の端末が見つかりませんでした。画面を読み込み直してください。",
  },
  /*
   * 現在利用中の端末を一覧からログアウトしようとした。
   * 通常のログアウトを使うべき操作であるため 409 にする。
   */
  [UserErrorCode.CurrentSession]: {
    status: 409,
    message: "利用中の端末はログアウトできません。通常のログアウトをご利用ください。",
  },
};

const userErrorTables: ErrorTables<UserErrorCode> = {
  kindOf: userErrorKind,
  viewOf: userErrorView,
};

/**
 * ユーザーのユースケースが失敗したときに、loader から投げる応答を作る。
 */
export const userErrorResponse = (context: ErrorContext, error: UserError) =>
  toErrorResponse(userErrorTables, context, error);

/**
 * ユーザーのユースケースが失敗したときに、action から画面へ返す誤りを作る。
 */
export const userActionErrors = (context: ErrorContext, error: UserError): ActionErrors<never> =>
  toActionErrors(userErrorTables, context, error);
