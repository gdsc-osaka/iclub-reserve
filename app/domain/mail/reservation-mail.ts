import { formatDateTime } from "~/lib/date";
import { ReservationTransition } from "~/domain/reservation/transition";
import type { MailDraft } from "./mail-outbox";

/** 予約に関する通知メールの種別。値は idempotencyKey にそのまま入るので変えないこと */
export const ReservationMailEvent = {
  Applied: "applied", // EVT-001
  Withdrawn: "withdrawn", // EVT-002
  Cancelled: "cancelled", // EVT-003
  Approved: "approved", // EVT-005
  Rejected: "rejected", // EVT-006
  CancelledByStaff: "cancelledByStaff", // EVT-007
} as const;
export type ReservationMailEvent = (typeof ReservationMailEvent)[keyof typeof ReservationMailEvent];

/** 通知メールの宛先となるユーザー情報 */
export interface ReservationMailRecipient {
  readonly userId?: string;
  readonly address: string;
  readonly name?: string | null;
}

export type ReservationMailRecipients = readonly ReservationMailRecipient[];

/** 予約 1 件についての通知先。事務局を分けているのは、イベントごとに送る・送らないが変わるため */
export interface ReservationMailAudience {
  /** 申請者 + その団体の管理者全員。メールアドレスで重複を除いてある */
  readonly groupMembers: ReservationMailRecipients;
  /** 事務局 (user.is_staff)。groupMembers に居る人は含まない */
  readonly staff: ReservationMailRecipients;
}

/** 事務局にも送るイベント (PRD 5 章)。操作者が事務局である通知は送らない */
export const notifiesStaff: Record<ReservationMailEvent, boolean> = {
  [ReservationMailEvent.Applied]: true,
  [ReservationMailEvent.Withdrawn]: false,
  [ReservationMailEvent.Cancelled]: true,
  [ReservationMailEvent.Approved]: false,
  [ReservationMailEvent.Rejected]: false,
  [ReservationMailEvent.CancelledByStaff]: false,
};

/**
 * 状態変更の操作と通知イベントの対応。Record にすることで、
 * 操作を足したときに通知を決め忘れると型エラーになる
 */
export const transitionMailEvent: Record<ReservationTransition, ReservationMailEvent> = {
  [ReservationTransition.Withdraw]: ReservationMailEvent.Withdrawn,
  [ReservationTransition.Cancel]: ReservationMailEvent.Cancelled,
  [ReservationTransition.Approve]: ReservationMailEvent.Approved,
  [ReservationTransition.Reject]: ReservationMailEvent.Rejected,
  [ReservationTransition.StaffCancel]: ReservationMailEvent.CancelledByStaff,
};

interface EventMailCopy {
  readonly subject: string;
  readonly opening: string;
  readonly allowsReason: boolean;
}

const eventMailCopy: Record<ReservationMailEvent, EventMailCopy> = {
  [ReservationMailEvent.Applied]: {
    subject: "【i-Club予約システム】施設・設備の利用予約が申請されました",
    opening: "施設・設備の利用予約が申請されました。",
    allowsReason: false,
  },
  [ReservationMailEvent.Withdrawn]: {
    subject: "【i-Club予約システム】施設・設備の仮予約が取り消されました",
    opening: "申請されていた仮予約が取り消されました。",
    allowsReason: true,
  },
  [ReservationMailEvent.Cancelled]: {
    subject: "【i-Club予約システム】施設・設備の利用予約がキャンセルされました",
    opening: "承認済みの利用予約がキャンセルされました。",
    allowsReason: true,
  },
  [ReservationMailEvent.Approved]: {
    subject: "【i-Club予約システム】施設・設備の利用予約が承認されました",
    opening: "申請されていた利用予約が承認されました。",
    allowsReason: false,
  },
  [ReservationMailEvent.Rejected]: {
    subject: "【i-Club予約システム】施設・設備の利用予約が却下されました",
    opening: "申請されていた利用予約が却下されました。",
    allowsReason: true,
  },
  [ReservationMailEvent.CancelledByStaff]: {
    subject: "【i-Club予約システム】施設・設備の利用予約が事務局によりキャンセルされました",
    opening: "承認済みの利用予約が事務局によりキャンセルされました。",
    allowsReason: true,
  },
};

/**
 * イベント種別と予約情報から本文を組み立てる純粋関数。
 * 署名と冒頭以外の骨組みは全イベント共通で、理由の有無のみイベントと入力値により分岐する。
 */
const buildBody = (
  event: ReservationMailEvent,
  reservation: { id: string; startAt: Date; endAt: Date; statusReason: string | null },
): string => {
  const copy = eventMailCopy[event];
  const lines = [
    "i-Club 予約システムをご利用いただきありがとうございます。",
    "",
    copy.opening,
    "",
    `予約ID: ${reservation.id}`,
    `利用開始日時: ${formatDateTime(reservation.startAt)}`,
    `利用終了日時: ${formatDateTime(reservation.endAt)}`,
  ];

  if (copy.allowsReason && reservation.statusReason !== null) {
    lines.push("", `理由: ${reservation.statusReason}`);
  }

  lines.push(
    "",
    "詳細はシステムにログインしてご確認ください。",
    "",
    "----------------------------------------",
    "大阪大学 Innovators' Club (i-Club) 予約システム",
    "※このメールは送信専用です。返信はできません。",
  );

  return lines.join("\n");
};

/**
 * 予約通知の MailDraft の配列を生成する純粋関数。
 *
 * - 宛先ごとに 1 通ずつ MailDraft を生成する。notifiesStaff が真のイベントのみ事務局にも送信する。
 * - idempotencyKey は `reservation:<event>:<reservationId>:<userId ?? address>` の形式で固定し、
 *   時刻や乱数を混ぜない（同じイベント・同じ宛先に対する重複送信を防ぐため）。
 * - 本文は送信時に DB を読み直さずに済むよう、レンダリング済みテキストとして埋め込む。
 *
 * @param event 発生した予約イベント
 * @param reservation 対象の予約情報
 * @param audience 宛先（団体メンバーおよび事務局）
 * @returns Transactional Outbox に積むための MailDraft の配列
 */
export const createReservationMailDrafts = (
  event: ReservationMailEvent,
  reservation: { id: string; startAt: Date; endAt: Date; statusReason: string | null },
  audience: ReservationMailAudience,
): readonly MailDraft[] => {
  const copy = eventMailCopy[event];
  const text = buildBody(event, reservation);
  const recipients = notifiesStaff[event]
    ? [...audience.groupMembers, ...audience.staff]
    : audience.groupMembers;

  return recipients.map((recipient) => {
    const targetId = recipient.userId ?? recipient.address;
    return {
      idempotencyKey: `reservation:${event}:${reservation.id}:${targetId}`,
      to: {
        address: recipient.address,
        ...(recipient.name ? { name: recipient.name } : {}),
      },
      subject: copy.subject,
      text,
    };
  });
};
