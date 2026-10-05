import { formatDateTime } from "~/lib/date";
import type { ReservationMessage } from "../reservation/message";
import { reservationDetailPath } from "../reservation";
import type { MailDraft } from "./mail-outbox";
import type { ReservationMailRecipient, ReservationMailRecipients } from "./reservation-mail";

/**
 * 予約メッセージ通知の宛先候補（EVT-008）。
 *
 * `ReservationMailAudience` とは異なり、各リスト間で互いの重複を取り除かない。
 * 事務局が団体の管理者を兼ねている場合でも、団体側の送信の通知は事務局として受け取るためである。
 */
export interface ReservationMessageAudience {
  /** 事務局員全員 (user.is_staff) */
  readonly staff: ReservationMailRecipients;
  /** 申請者 + その団体の管理者全員 */
  readonly groupMembers: ReservationMailRecipients;
  /** その予約に sent_as_staff = false のメッセージを送った過去の送信者 */
  readonly priorGroupSideSenders: ReservationMailRecipients;
}

/**
 * メッセージ通知の宛先を選定する純粋関数（EVT-008）。
 *
 * 候補（audience）は、送信の時点で予約の全項目を見られる人（COND-008 の (1)）に絞ってある前提。
 *
 * - sentAsStaff が false（団体側の送信）:
 *   宛先は事務局（staff）全員。申請者・管理者・過去の送信者には送らない。
 * - sentAsStaff が true（事務局としての送信）:
 *   宛先は申請者・団体管理者全員（groupMembers）と、その予約に sent_as_staff = false の
 *   メッセージを送ったことのある人（priorGroupSideSenders）を合わせたもの。
 * - どちらの場合も：
 *   - 送信者本人（userId === senderUserId）は宛先から除く。
 *   - メールアドレス（address）の重複を取り除く。
 *   - メールアドレスの昇順（a.address.localeCompare(b.address)）に並べる。
 */
export const selectReservationMessageRecipients = (
  audience: ReservationMessageAudience,
  options: {
    readonly sentAsStaff: boolean;
    readonly senderUserId: string;
  },
): ReservationMailRecipients => {
  const candidates = options.sentAsStaff
    ? [...audience.groupMembers, ...audience.priorGroupSideSenders]
    : audience.staff;

  const map = new Map<string, ReservationMailRecipient>();
  for (const recipient of candidates) {
    if (recipient.userId === options.senderUserId) continue;
    if (!map.has(recipient.address)) {
      map.set(recipient.address, recipient);
    }
  }

  return Array.from(map.values()).sort((a, b) => a.address.localeCompare(b.address));
};

export interface CreateReservationMessageMailDraftsArgs {
  readonly message: ReservationMessage;
  readonly reservation: {
    readonly id: string;
    readonly startAt: Date;
    readonly endAt: Date;
  };
  /** 送信者の氏名。sent_as_staff = true の場合は本文に含めず「事務局」と表示する */
  readonly senderName: string;
  readonly recipients: ReservationMailRecipients;
  readonly appBaseUrl: string;
}

/**
 * 予約メッセージ通知メールの本文を組み立てる純粋関数。
 */
const buildMessageMailBody = (args: CreateReservationMessageMailDraftsArgs): string => {
  const senderDisplay = args.message.sentAsStaff ? "事務局" : args.senderName;
  const detailUrl = `${args.appBaseUrl}${reservationDetailPath(args.reservation.id)}`;

  const lines = [
    "i-Club 予約システムをご利用いただきありがとうございます。",
    "",
    "予約にメッセージが届きました。",
    "",
    `予約ID: ${args.reservation.id}`,
    `利用開始日時: ${formatDateTime(args.reservation.startAt)}`,
    `利用終了日時: ${formatDateTime(args.reservation.endAt)}`,
    `送信者: ${senderDisplay}`,
    "",
    "メッセージ:",
    args.message.body,
    "",
    "返信は、このメールではなく予約詳細ページから送ってください。",
    detailUrl,
    "",
    "----------------------------------------",
    "大阪大学 Innovators' Club (i-Club) 予約システム",
    "※このメールは送信専用です。返信はできません。",
  ];

  return lines.join("\n");
};

/**
 * 予約メッセージ通知の MailDraft 配列を生成する純粋関数。
 *
 * - 件名: 「【i-Club予約システム】予約にメッセージが届きました」
 * - 本文: text のみ（html は作らない。利用者の入力をそのまま載せるため）。
 * - 送信者表示: sentAsStaff が true なら「事務局」と表示し senderName は出さない（COND-008）。
 *   false なら senderName を表示する。
 * - idempotencyKey: `reservation-message:<messageId>:<userId ?? address>`。
 *   メッセージ送信ごとに新しい messageId が発行されるため、時刻を入れなくても衝突しない。
 */
export const createReservationMessageMailDrafts = (
  args: CreateReservationMessageMailDraftsArgs,
): readonly MailDraft[] => {
  const text = buildMessageMailBody(args);

  return args.recipients.map((recipient) => {
    const targetId = recipient.userId ?? recipient.address;
    return {
      idempotencyKey: `reservation-message:${args.message.id}:${targetId}`,
      to: {
        address: recipient.address,
        ...(recipient.name ? { name: recipient.name } : {}),
      },
      subject: "【i-Club予約システム】予約にメッセージが届きました",
      text,
    };
  });
};
