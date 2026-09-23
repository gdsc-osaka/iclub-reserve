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
 * 団体の画面（SCR-007）で、操作しようとした招待が無い・見られないときに出す行。
 *
 * 招待はフォームで指しているので、無くなっていても URL の団体はあり、画面は出せる。
 * 画面を開いた後に状態が変わった（画面が古い）という意味で 409 にする。
 * 404 のままにすると、action がこの画面ごと「団体が見つかりません」に差し替えてしまう。
 *
 * `InvitationNotVisible` もこの行にする。団体の画面の操作では起きない（宛先を確かめるのは承諾画面だけ）が、
 * 表は網羅が要るので、起きたときにも同じ案内になるようにしておく。
 */
const INVITATION_GONE_IN_FORM: ErrorView = {
  status: 409,
  message: "対象の招待が見つかりませんでした。画面を読み込み直してください。",
};

/**
 * 団体まわりのエラーを、利用者にどう見せるかの表（ADR-004 決定 5）。
 *
 * 団体を扱うすべての画面がこの 1 枚を使う。画面ごとに文言を書くと、
 * 同じ失敗が場所によって違う言い方で出てしまう。
 * `userMessage` を持つエラーは、`message` の代わりにそちらが出る（`toActionErrors` を参照）。
 *
 * 招待の 2 行は、招待をフォームで指す団体の画面（SCR-007）のためのもの。
 * 招待を URL で指す承諾画面（SCR-016）では、`invitationErrorView` が差し替える。
 */
export const groupErrorView: Record<GroupErrorCode, ErrorView> = {
  [GroupErrorCode.NotFound]: { message: GROUP_NOT_FOUND_TEXT },
  // COND-011: 見えないことを「無い」として答える。既定の 403 を意図的に破っている
  [GroupErrorCode.NotVisible]: { status: 404, message: GROUP_NOT_FOUND_TEXT },
  [GroupErrorCode.Forbidden]: { message: "この操作を行う権限がありません。" },
  [GroupErrorCode.InvalidInput]: { message: "入力内容を確認してください。" },
  /*
   * 404 はこの画面の URL が指す団体が無いときにだけ使う。メンバーはフォームで指しているので、
   * 無くなっていても URL は正しく、画面は出せる。画面を開いた後に状態が変わった（画面が古い）という意味で 409 にする。
   * 404 のままにすると、action がこの画面ごと「団体が見つかりません」に差し替えてしまう。
   */
  [GroupErrorCode.MemberNotFound]: {
    status: 409,
    message: "対象のメンバーが見つかりませんでした。画面を読み込み直してください。",
  },
  [GroupErrorCode.InvitationNotFound]: INVITATION_GONE_IN_FORM,
  [GroupErrorCode.InvitationNotVisible]: INVITATION_GONE_IN_FORM,
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

/**
 * 招待が無いときと、宛先が本人ではないときに出す文言。
 *
 * 2 つを必ず同じにするため、1 か所にだけ書く（COND-011）。
 */
const INVITATION_NOT_FOUND_TEXT = "招待が見つかりません。";

/**
 * 招待の承諾画面（SCR-016）で使う表。招待の 2 行だけが `groupErrorView` と違う。
 *
 * この画面では、招待は URL が指すもの（画面そのもの）である。無ければ画面ごと 404 にする。
 * 団体の画面（SCR-007）では招待をフォームで指すので 409 にしており、同じコードでも見せ方が変わる
 * （予約の `NotFound` と同じ事情。ADR-004 決定 7）。
 *
 * どちらの行も 404 なので、action でも返さずに投げる。投げる応答は表の文言だけを使うので、
 * 宛先違いに誰かが `userMessage` を書いても応答は変わらない。
 */
export const invitationErrorView: Record<GroupErrorCode, ErrorView> = {
  ...groupErrorView,
  [GroupErrorCode.InvitationNotFound]: { message: INVITATION_NOT_FOUND_TEXT },
  // COND-011: 宛先が違うことを「無い」として答える。既定の 403 を意図的に破っている
  [GroupErrorCode.InvitationNotVisible]: { status: 404, message: INVITATION_NOT_FOUND_TEXT },
};

const invitationErrorTables: ErrorTables<GroupErrorCode> = {
  kindOf: groupErrorKind,
  viewOf: invitationErrorView,
};

/**
 * 招待の承諾画面で、ユースケースが失敗したときに loader から投げる応答を作る。
 *
 * 宛先が本人ではない招待も、無い招待と同じ 404 になる。
 *
 * @example
 * throw invitationErrorResponse({ where: "invitations.accept.loader", userId: user.id }, result.error);
 */
export const invitationErrorResponse = (context: ErrorContext, error: GroupError) =>
  toErrorResponse(invitationErrorTables, context, error);

/**
 * 招待の承諾画面で、ユースケースが失敗したときに action から画面へ返す誤りを作る。
 *
 * 招待が無い・宛先が違うときは、返さずに loader と同じ 404 を投げる。
 * loader が 404 を返す状況で action だけ 200 を返すと、応答の違いから招待の有無を推測できてしまう。
 * この画面には入力欄が無いので、誤りはすべてフォームの上に出る。
 */
export const invitationActionErrors = (
  context: ErrorContext,
  error: GroupError,
): ActionErrors<never> => toActionErrors(invitationErrorTables, context, error);
