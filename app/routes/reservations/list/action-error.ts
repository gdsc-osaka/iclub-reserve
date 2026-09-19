import { ReservationErrorCode, type ReservationError } from "~/domain/reservation";

/**
 * 操作に失敗したときに、画面へ出す文言を決める。
 *
 * エラーの `message` をそのまま画面へ出さないのは、DB の失敗のように
 * 利用者には意味が無く、こちらの内部の事情（テーブル名・SQL の失敗など）が
 * にじむ文言が混ざるため。出してよいのは、どうすれば直せるかを利用者に伝える
 * 種類のエラー（理由の未入力・重なり・許されない操作）だけに絞る。
 *
 * 詳しい原因はサーバー側のログに残す。画面に出す文言を厚くしても、
 * 利用者にできることは増えない。
 */
export const toActionErrorMessage = (error: ReservationError): string => {
  switch (error.code) {
    /*
     * ここで `error.message` を通すのは、ドメインが利用者に向けて書いた文言だから
     * （「却下理由を入力してください。」など）。
     */
    case ReservationErrorCode.ReservationInvalidTransition:
    case ReservationErrorCode.ReservationInvalidInput:
    case ReservationErrorCode.ReservationInvalidPeriod:
    case ReservationErrorCode.ReservationConflict:
      return error.message;

    case ReservationErrorCode.ReservationNotFound:
      return "予約が見つかりませんでした。画面を読み込み直してください。";

    case ReservationErrorCode.ReservationForbidden:
      return "この予約を操作する権限がありません。";

    case ReservationErrorCode.ReservationGroupNotEligible:
      return "この団体は現在ご利用いただけません。事務局にお問い合わせください。";

    case ReservationErrorCode.ReservationFacilityNotAvailable:
      return "対象の施設・設備が利用できなくなっています。";

    case ReservationErrorCode.DatabaseError:
      return "操作できませんでした。時間をおいて、もう一度お試しください。";
  }
};
