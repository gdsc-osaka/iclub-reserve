import { ReservationErrorCode, type ReservationError } from "~/domain/reservation";
import type { QueryError } from "~/query/error";

/**
 * 通知先の取得で起きた読み取りエラーを ReservationError に変換する。
 *
 * 握りつぶして通知なしで書き込みを進めてはいけない。
 * 申請も承認も、相手に届いて初めて業務が回るため、
 * 宛先が引けなかったのなら失敗として返し、やり直してもらう。
 */
export const toRecipientsError = (error: QueryError): ReservationError => ({
  code: ReservationErrorCode.DatabaseError,
  message: "通知先のメールアドレスを読み取れなかった。",
  cause: error,
});
