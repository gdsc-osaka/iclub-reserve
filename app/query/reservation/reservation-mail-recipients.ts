import type { ResultAsync } from "neverthrow";
import type {
  ReservationMailAudience,
  ReservationMailRecipient,
  ReservationMailRecipients,
} from "~/domain/mail/reservation-mail";
import type { QueryError } from "../error";

export type { ReservationMailAudience, ReservationMailRecipient, ReservationMailRecipients };

/**
 * 予約通知の宛先を取得する読み取り専用の窓口（ポート）。
 *
 * 返る型はドメインの不変条件を持たないので、
 * この結果を使って更新してはいけない。
 */
export interface ReservationMailRecipientsQuery {
  /** 既存の予約についての通知先 (EVT-002/003/005/006/007) */
  findByReservationId(reservationId: string): ResultAsync<ReservationMailAudience, QueryError>;

  /**
   * これから作る予約についての通知先 (EVT-001)。
   * 予約の行がまだ無いので、申請者と団体を直接指定して引く。
   */
  findForNewReservation(args: {
    readonly groupId: string;
    readonly applicantUserId: string;
  }): ResultAsync<ReservationMailAudience, QueryError>;
}
