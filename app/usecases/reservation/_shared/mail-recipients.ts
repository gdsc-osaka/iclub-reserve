import type { ResultAsync } from "neverthrow";
import type { ReservationMailNames } from "~/domain/mail/reservation-mail";
import { ReservationErrorCode, type ReservationError } from "~/domain/reservation";
import type { QueryError } from "~/query/error";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";

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

/** 通知に載せる施設・設備と団体の名前を引く。引けなければ、宛先と同じく失敗として返す */
export const resolveReservationMailNames = (
  deps: { readonly reservationMailRecipientsQuery: ReservationMailRecipientsQuery },
  ids: { readonly facilityId: string; readonly groupId: string },
): ResultAsync<ReservationMailNames, ReservationError> =>
  deps.reservationMailRecipientsQuery.findNames(ids).mapErr((cause) => ({
    code: ReservationErrorCode.DatabaseError,
    message: "通知に載せる施設・団体の名前を読み取れなかった。",
    cause,
  }));
