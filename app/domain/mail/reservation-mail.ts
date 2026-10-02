import { formatDateTime } from "~/lib/date";
import { ReservationEditOutcome, type AppliedReservationEdit } from "~/domain/reservation/edit";
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
  ApprovedEdited: "approvedEdited", // EVT-004（使用人数・備考の変更。承認済みのまま）
  ReapprovalRequested: "reapprovalRequested", // EVT-004（施設・日時の変更。仮予約に戻る）
  ProvisionalEdited: "provisionalEdited", // EVT-012
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
  [ReservationMailEvent.ApprovedEdited]: true,
  [ReservationMailEvent.ReapprovalRequested]: true,
  [ReservationMailEvent.ProvisionalEdited]: true,
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

/**
 * 内容の変更の結果と通知イベントの対応（UC-005 / UC-017）。
 *
 * 承認済みの予約の変更（EVT-004）は、仮予約に戻ったかどうかで文面を分ける。
 * 戻ったのに「変更されました」とだけ伝えると、利用者は承認済みのままだと思い込み、
 * 再承認を待たずに使いに来てしまう。
 */
export const editMailEvent: Record<AppliedReservationEdit, ReservationMailEvent> = {
  [ReservationEditOutcome.KeepProvisional]: ReservationMailEvent.ProvisionalEdited,
  [ReservationEditOutcome.KeepApproved]: ReservationMailEvent.ApprovedEdited,
  [ReservationEditOutcome.Reapproval]: ReservationMailEvent.ReapprovalRequested,
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
  [ReservationMailEvent.ApprovedEdited]: {
    subject: "【i-Club予約システム】施設・設備の利用予約の内容が変更されました",
    opening:
      "承認済みの利用予約の内容（使用人数・備考）が変更されました。承認済みのまま変わりません。",
    allowsReason: false,
  },
  [ReservationMailEvent.ReapprovalRequested]: {
    subject: "【i-Club予約システム】施設・設備の利用予約が変更され、再承認待ちになりました",
    opening:
      "承認済みの利用予約の施設・日時が変更されたため、仮予約に戻りました。事務局が改めて承認するまで、施設・設備は利用できません。",
    allowsReason: false,
  },
  [ReservationMailEvent.ProvisionalEdited]: {
    subject: "【i-Club予約システム】施設・設備の仮予約の内容が変更されました",
    opening: "申請されていた仮予約の内容が変更されました。",
    allowsReason: false,
  },
};

/** 通知に載せる予約の情報 */
export interface ReservationMailSubject {
  readonly id: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly statusReason: string | null;
  /**
   * この通知を出した書き込みで、予約に入れた更新日時。
   *
   * 本文には出さず、idempotencyKey にだけ使う（createReservationMailDrafts を参照）。
   */
  readonly updatedAt: Date;
}

/**
 * イベント種別と予約情報から本文を組み立てる純粋関数。
 * 署名と冒頭以外の骨組みは全イベント共通で、理由の有無のみイベントと入力値により分岐する。
 */
const buildBody = (event: ReservationMailEvent, reservation: ReservationMailSubject): string => {
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
 * - idempotencyKey は `reservation:<event>:<reservationId>:<updatedAt のミリ秒>:<userId ?? address>` の形式とする。
 * - 本文は送信時に DB を読み直さずに済むよう、レンダリング済みテキストとして埋め込む。
 *
 * 【idempotencyKey に更新日時を入れる理由】
 * `mail-outbox.ts` は「idempotencyKey に時刻を混ぜない」と定めているが、予約の通知は例外とする。
 * 1. 同じイベントが 1 件の予約に何度も起きる。内容の変更（EVT-004 / EVT-012）は何度でもでき、
 *    承認（EVT-005）も、施設・日時の変更で仮予約に戻った（UC-005）あとにもう一度起きる。
 *    時刻を入れないと、2 回目からの通知は鍵の衝突によって黙って捨てられる。
 * 2. 時刻を入れても、同じ操作をやり直しただけで 2 通積まれることはない。予約の更新はどれも
 *    「読んだときの状態から変わっていないこと」を条件にしており、メールは更新が実際に起きたときにだけ積まれる
 *    （guardedMailOutboxInserts）。作成は毎回新しい予約 ID になるので、もともと鍵は衝突しない。
 * 入れる時刻は、その書き込みで予約に入れた更新日時にする。いまの時刻を別に読むと、
 * 何の時刻なのかが鍵から読み取れなくなる。
 *
 * @param event 発生した予約イベント
 * @param reservation 対象の予約情報
 * @param audience 宛先（団体メンバーおよび事務局）
 * @returns Transactional Outbox に積むための MailDraft の配列
 */
export const createReservationMailDrafts = (
  event: ReservationMailEvent,
  reservation: ReservationMailSubject,
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
      idempotencyKey: `reservation:${event}:${reservation.id}:${reservation.updatedAt.getTime()}:${targetId}`,
      to: {
        address: recipient.address,
        ...(recipient.name ? { name: recipient.name } : {}),
      },
      subject: copy.subject,
      text,
    };
  });
};
