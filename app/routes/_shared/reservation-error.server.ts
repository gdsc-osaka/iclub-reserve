import {
  ReservationErrorCode,
  reservationErrorKind,
  type ReservationError,
  type ReservationField,
} from "~/domain/reservation";

import {
  toActionErrors,
  toErrorResponse,
  type ActionErrors,
  type ErrorContext,
  type ErrorTables,
  type ErrorView,
} from "./error-response.server";

/**
 * 予約が無いときと、見られないときに出す文言。
 *
 * 2 つを必ず同じにするため、1 か所にだけ書く（COND-008。団体の COND-011 と同じ考え方）。
 */
const RESERVATION_NOT_FOUND_TEXT = "予約が見つかりません。";

/**
 * 予約まわりのエラーを、利用者にどう見せるかの表（ADR-004 決定 5）。
 *
 * 予約を扱うすべての画面がこの 1 枚を使う。画面ごとに文言を書くと、
 * 同じ失敗が場所によって違う言い方で出てしまう。
 * `userMessage` を持つエラーは、`message` の代わりにそちらが出る（`toActionErrors` を参照）。
 *
 * `NotFound` と `NotVisible` の行は、予約を URL で指す画面（予約詳細 SCR-005）のためのもの。
 * 予約をフォームの値で指す action では、`reservationActionErrorView` が差し替える。
 */
export const reservationErrorView: Record<ReservationErrorCode, ErrorView> = {
  [ReservationErrorCode.NotFound]: { message: RESERVATION_NOT_FOUND_TEXT },
  // 見られないことを「無い」として答える。既定の 403 を意図的に破っている
  [ReservationErrorCode.NotVisible]: { status: 404, message: RESERVATION_NOT_FOUND_TEXT },
  [ReservationErrorCode.Forbidden]: { message: "この予約を操作する権限がありません。" },
  [ReservationErrorCode.InvalidPeriod]: { message: "利用時間を確認してください。" },
  [ReservationErrorCode.InvalidInput]: { message: "入力内容を確認してください。" },
  [ReservationErrorCode.InvalidTransition]: {
    message: "いまの状態では、この予約を操作できません。画面を読み込み直してください。",
  },
  [ReservationErrorCode.Conflict]: {
    message: "ほかの予約や操作と重なりました。画面を読み込み直してください。",
  },
  [ReservationErrorCode.GroupNotEligible]: {
    message: "この団体は現在ご利用いただけません。事務局にお問い合わせください。",
  },
  [ReservationErrorCode.FacilityNotAvailable]: {
    message: "対象の施設・設備が利用できなくなっています。",
  },
  [ReservationErrorCode.DatabaseError]: {
    message: "操作できませんでした。時間をおいて、もう一度お試しください。",
  },
};

/**
 * action で、予約が無い・見られないときに出す行。
 *
 * 2 つのコードでこの 1 行を共有する。応答が違うと、その違いから予約の有無を推測できてしまう。
 * 投げずにフォームへ返す行なので、`userMessage` で応答が変わらないよう `ignoreUserMessage` を付ける。
 */
const RESERVATION_GONE_IN_FORM: ErrorView = {
  status: 409,
  message: "対象の予約が見つかりませんでした。画面を読み込み直してください。",
  ignoreUserMessage: true,
};

/**
 * action で使う表。予約が無い・見られないときだけ、`reservationErrorView` と違う。
 *
 * 予約を操作する action は、いまはどれも予約を URL ではなくフォームの値で指している
 * （予約一覧 SCR-003 の各行の操作）。予約が無くても URL の画面は出せるので、
 * 画面ごと 404 に差し替えずに、フォームの上へ読み込み直しの案内を出す
 * （団体の表の `MemberNotFound` を 409 にしているのと同じ理由。ADR-004 決定 7）。
 * 予約は物理削除しないので、ここに来るのはフォームの値が書き換えられたときだけである。
 *
 * 予約を URL で指す画面（予約詳細 SCR-005）に action を足すときは、
 * 団体の画面と同じく 404 を投げるべきなので、こちらではなく `reservationErrorView` を使う関数を足すこと。
 */
export const reservationActionErrorView: Record<ReservationErrorCode, ErrorView> = {
  ...reservationErrorView,
  [ReservationErrorCode.NotFound]: RESERVATION_GONE_IN_FORM,
  [ReservationErrorCode.NotVisible]: RESERVATION_GONE_IN_FORM,
};

const reservationErrorTables: ErrorTables<ReservationErrorCode> = {
  kindOf: reservationErrorKind,
  viewOf: reservationErrorView,
};

const reservationActionErrorTables: ErrorTables<ReservationErrorCode> = {
  kindOf: reservationErrorKind,
  viewOf: reservationActionErrorView,
};

/**
 * 予約のユースケースが失敗したときに、loader から投げる応答を作る。
 *
 * 見られない予約も、無い予約と同じ 404 になる。
 *
 * @example
 * throw reservationErrorResponse({ where: "reservations.detail.loader", userId: user.id }, result.error);
 */
export const reservationErrorResponse = (context: ErrorContext, error: ReservationError) =>
  toErrorResponse(reservationErrorTables, context, error);

/**
 * 予約のユースケースが失敗したときに、action から画面へ返す誤りを作る。
 *
 * 予約が無い・見られないときも投げずに返す（`reservationActionErrorView` を参照）。
 *
 * @param fieldOf ドメインの項目から、この画面の入力欄を引く表。欄が無い画面では省く
 * @example
 * return {
 *   values,
 *   ...reservationActionErrors(context, result.error, { [ReservationField.Period]: "period" }),
 * };
 */
export const reservationActionErrors = <K extends string = never>(
  context: ErrorContext,
  error: ReservationError,
  fieldOf?: Partial<Record<ReservationField, K>>,
): ActionErrors<NoInfer<K>> =>
  toActionErrors(reservationActionErrorTables, context, error, fieldOf);
