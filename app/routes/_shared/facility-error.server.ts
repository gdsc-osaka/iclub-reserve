import {
  FacilityErrorCode,
  facilityErrorKind,
  type FacilityError,
  type FacilityField,
} from "~/domain/facility";

import {
  toActionErrors,
  toErrorResponse,
  type ActionErrors,
  type ErrorContext,
  type ErrorTables,
  type ErrorView,
} from "./error-response.server";

/**
 * 施設まわりのエラーを、利用者にどう見せるかの表（ADR-004 決定 5）。
 *
 * 施設を扱うすべての画面がこの 1 枚を使う。画面ごとに文言を書くと、
 * 同じ失敗が場所によって違う言い方で出てしまう。
 * `userMessage` を持つエラーは、`message` の代わりにそちらが出る（`toActionErrors` を参照）。
 */
export const facilityErrorView: Record<FacilityErrorCode, ErrorView> = {
  [FacilityErrorCode.NotFound]: { message: "施設・設備が見つかりません。" },
  [FacilityErrorCode.Forbidden]: { message: "この操作を行う権限がありません。" },
  [FacilityErrorCode.InvalidInput]: { message: "入力内容を確認してください。" },
  /*
   * 画面を開いた後に別の管理者が状態を変更した場合などに発生する。
   * 画面が古いという意味で 409 にする。
   */
  [FacilityErrorCode.InvalidTransition]: {
    status: 409,
    message: "施設の状態が変わっています。画面を読み込み直してください。",
  },
  /*
   * 編集の保存中に、別の人が同じ施設の写真を先に変えた。
   * 画面が古いという意味で 409 にする。
   */
  [FacilityErrorCode.Conflict]: {
    status: 409,
    message: "ほかの人が同時にこの施設を更新しました。画面を読み込み直してください。",
  },
  /*
   * 将来の予約が残っているため無効化できない（COND-003）。
   * 予約の状態との競合であるため 409 にする。
   */
  [FacilityErrorCode.HasUpcomingReservations]: {
    status: 409,
    message: "今後の予約が残っているため、無効化できません。",
  },
  [FacilityErrorCode.PhotoStorageError]: {
    message: "写真を保存できませんでした。時間をおいて、もう一度お試しください。",
  },
  [FacilityErrorCode.DatabaseError]: {
    message: "処理を完了できませんでした。時間をおいて、もう一度お試しください。",
  },
};

const facilityErrorTables: ErrorTables<FacilityErrorCode> = {
  kindOf: facilityErrorKind,
  viewOf: facilityErrorView,
};

/**
 * 施設のユースケースが失敗したときに、loader から投げる応答を作る。
 *
 * @example
 * throw facilityErrorResponse({ where: "staff.facilities.edit.loader", userId: user.id }, result.error);
 */
export const facilityErrorResponse = (context: ErrorContext, error: FacilityError) =>
  toErrorResponse(facilityErrorTables, context, error);

/**
 * 施設のユースケースが失敗したときに、action から画面へ返す誤りを作る。
 *
 * @param fieldOf ドメインの項目から、この画面の入力欄を引く表。欄が無い画面では省く
 * @example
 * return {
 *   submittedValues,
 *   ...facilityActionErrors(context, result.error, { [FacilityField.Name]: "nameError" }),
 * };
 */
export const facilityActionErrors = <K extends string = never>(
  context: ErrorContext,
  error: FacilityError,
  fieldOf?: Partial<Record<FacilityField, K>>,
): ActionErrors<NoInfer<K>> => toActionErrors(facilityErrorTables, context, error, fieldOf);
