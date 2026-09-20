import { formatDateTime } from "~/lib/date";
import type { MailDraft } from "./mail-outbox";

/** メール宛先情報の入力型 */
export interface ReservationApprovedMailRecipient {
  readonly userId?: string;
  readonly address: string;
  readonly name?: string | null;
}

/** 承認メールの文面生成に必要な予約情報 */
export interface ReservationApprovedMailReservation {
  readonly id: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

/** 承認通知メールの件名 */
export const buildReservationApprovedSubject = (): string =>
  "【i-Club予約システム】施設・設備の利用予約が承認されました";

/** 承認通知メールの本文（テキスト） */
export const buildReservationApprovedBody = (
  reservation: ReservationApprovedMailReservation,
): string =>
  [
    "i-Club 予約システムをご利用いただきありがとうございます。",
    "",
    "申請されていた利用予約が承認されました。",
    "",
    `予約ID: ${reservation.id}`,
    `利用開始日時: ${formatDateTime(reservation.startAt)}`,
    `利用終了日時: ${formatDateTime(reservation.endAt)}`,
    "",
    "詳細はシステムにログインしてご確認ください。",
    "",
    "----------------------------------------",
    "大阪大学 Innovators' Club (i-Club) 予約システム",
    "※このメールは送信専用です。返信はできません。",
  ].join("\n");

/**
 * 予約承認通知（EVT-005）の MailDraft の配列を生成する純粋関数。
 *
 * - 宛先ごとに 1 通ずつ MailDraft を生成する。
 * - idempotencyKey は `reservation:approved:<reservationId>:<userId>` の形式で固定し、
 *   時刻や乱数を混ぜない（同じイベント・同じ宛先に対する重複送信を防ぐため）。
 * - 本文は送信時に DB を読み直さずに済むよう、レンダリング済みテキストとして埋め込む。
 *
 * @param reservation 承認された予約情報
 * @param recipients 宛先リスト（申請者および団体管理者）
 * @returns Transactional Outbox に積むための MailDraft の配列
 */
export const createReservationApprovedMailDrafts = (
  reservation: ReservationApprovedMailReservation,
  recipients: readonly ReservationApprovedMailRecipient[],
): readonly MailDraft[] => {
  const subject = buildReservationApprovedSubject();
  const text = buildReservationApprovedBody(reservation);

  return recipients.map((recipient) => {
    const targetId = recipient.userId ?? recipient.address;
    return {
      idempotencyKey: `reservation:approved:${reservation.id}:${targetId}`,
      to: {
        address: recipient.address,
        ...(recipient.name ? { name: recipient.name } : {}),
      },
      subject,
      text,
    };
  });
};
