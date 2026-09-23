import { GroupErrorCode, groupErrorKind, type GroupError, type GroupField } from "~/domain/group";

import {
  toActionErrors,
  toErrorResponse,
  type ActionErrors,
  type ErrorContext,
  type ErrorTables,
  type ErrorView,
} from "./error-response.server";

/**
 * 団体が無いときと、見られないときに出す文言。
 *
 * 2 つを必ず同じにするため、1 か所にだけ書く（COND-011）。
 */
const GROUP_NOT_FOUND_TEXT = "団体が見つかりません。";

/**
 * 団体まわりのエラーを、利用者にどう見せるかの表（ADR-004 決定 5）。
 *
 * 団体を扱うすべての画面がこの 1 枚を使う。画面ごとに文言を書くと、
 * 同じ失敗が場所によって違う言い方で出てしまう。
 * `userMessage` を持つエラーは、`message` の代わりにそちらが出る（`toActionErrors` を参照）。
 */
export const groupErrorView: Record<GroupErrorCode, ErrorView> = {
  [GroupErrorCode.NotFound]: { message: GROUP_NOT_FOUND_TEXT },
  // COND-011: 見えないことを「無い」として答える。既定の 403 を意図的に破っている
  [GroupErrorCode.NotVisible]: { status: 404, message: GROUP_NOT_FOUND_TEXT },
  [GroupErrorCode.Forbidden]: { message: "この操作を行う権限がありません。" },
  [GroupErrorCode.InvalidInput]: { message: "入力内容を確認してください。" },
  /*
   * 404 はこの画面の URL が指す団体が無いときにだけ使う。メンバーや招待はフォームで指しているので、
   * 無くなっていても URL は正しく、画面は出せる。画面を開いた後に状態が変わった（画面が古い）という意味で 409 にする。
   * 404 のままにすると、action がこの画面ごと「団体が見つかりません」に差し替えてしまう。
   */
  [GroupErrorCode.MemberNotFound]: {
    status: 409,
    message: "対象のメンバーが見つかりませんでした。画面を読み込み直してください。",
  },
  [GroupErrorCode.InvitationNotFound]: {
    status: 409,
    message: "対象の招待が見つかりませんでした。画面を読み込み直してください。",
  },
  [GroupErrorCode.LastAdminRequired]: {
    message:
      "管理者が 0 人になるため、この操作はできません。先に別のメンバーを管理者にしてください。",
  },
  [GroupErrorCode.DatabaseError]: {
    message: "保存できませんでした。時間をおいて、もう一度お試しください。",
  },
};

const groupErrorTables: ErrorTables<GroupErrorCode> = {
  kindOf: groupErrorKind,
  viewOf: groupErrorView,
};

/**
 * 団体のユースケースが失敗したときに、loader から投げる応答を作る。
 *
 * @example
 * throw groupErrorResponse({ where: "groups.detail.loader", userId: user.id }, result.error);
 */
export const groupErrorResponse = (context: ErrorContext, error: GroupError) =>
  toErrorResponse(groupErrorTables, context, error);

/**
 * 団体のユースケースが失敗したときに、action から画面へ返す誤りを作る。
 *
 * 団体が無い・見られないときは、返さずに loader と同じ 404 を投げる（COND-011）。
 *
 * @param fieldOf ドメインの項目から、この画面の入力欄を引く表。欄が無い画面では省く
 * @example
 * return {
 *   submittedName,
 *   ...groupActionErrors(context, result.error, { [GroupField.Name]: "nameError" }),
 * };
 */
export const groupActionErrors = <K extends string = never>(
  context: ErrorContext,
  error: GroupError,
  fieldOf?: Partial<Record<GroupField, K>>,
): ActionErrors<NoInfer<K>> => toActionErrors(groupErrorTables, context, error, fieldOf);
