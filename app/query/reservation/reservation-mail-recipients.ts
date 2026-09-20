import type { ResultAsync } from "neverthrow";
import type { QueryError } from "../error";

/** 通知メールの宛先となるユーザー情報 */
export interface ReservationMailRecipient {
  readonly userId?: string;
  readonly address: string;
  readonly name: string | null;
}

export type ReservationMailRecipients = readonly ReservationMailRecipient[];

/**
 * 予約通知の宛先を取得する読み取り専用の窓口（ポート）。
 *
 * 返る型はドメインの不変条件を持たないので、
 * この結果を使って更新してはいけない。
 */
export interface ReservationMailRecipientsQuery {
  /**
   * 予約 ID を指定して、通知の宛先（申請者および該当団体の管理者全員）を取得する。
   *
   * - 申請者と団体管理者でメールアドレスが重複する場合は、1 件にまとめる（申請者が管理者を兼ねている場合に 2 通届かないようにする）。
   * - reservation.createdBy が null の場合は、申請者を宛先に含めない。
   * - 該当の予約が存在しない場合は NOT_FOUND エラーを返す。
   * - 並び順はメールアドレスの昇順で固定する。
   */
  findByReservationId(reservationId: string): ResultAsync<ReservationMailRecipients, QueryError>;
}
