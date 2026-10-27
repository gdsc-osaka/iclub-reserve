import {
  ReservationEditOutcome,
  type AppliedReservationEdit,
  type DirectReservationEditOutcome,
} from "~/domain/reservation/edit";
import type { UnlockArrangement } from "~/domain/reservation";
import { STAFF_SENDER_LABEL } from "~/domain/reservation/message";
import { ReservationTransition } from "~/domain/reservation/transition";
import { unlockArrangementGroupNotice } from "~/domain/reservation/unlock-arrangement";
import { AppArea } from "~/lib/app-area";
import { formatDateTime } from "~/lib/date";
import { toReservationDetailPath } from "~/lib/reservation-paths";
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
  EditedByStaff: "editedByStaff", // EVT-017
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
  [ReservationMailEvent.EditedByStaff]: false,
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

/**
 * 事務局による直接変更の結果と通知イベントの対応（UC-008 / EVT-017）。
 *
 * 仮予約・承認済みのどちらを変更した場合も同じイベントで通知する。
 * 直接変更ではステータスが変わらないので、文面を分ける必要がない。
 */
export const directEditMailEvent: Record<
  Exclude<DirectReservationEditOutcome, typeof ReservationEditOutcome.NoChange>,
  ReservationMailEvent
> = {
  [ReservationEditOutcome.KeepProvisional]: ReservationMailEvent.EditedByStaff,
  [ReservationEditOutcome.KeepApproved]: ReservationMailEvent.EditedByStaff,
};

interface EventMailCopy {
  readonly subject: string;
  readonly opening: string;
  readonly allowsReason: boolean;
  /** 解錠の手配の案内を載せるか（EVT-005） */
  readonly includesUnlockNotice: boolean;
  /** 操作と同時に送ったメッセージを載せるか（EVT-005・REQ-048） */
  readonly includesMessage: boolean;
}

const eventMailCopy: Record<ReservationMailEvent, EventMailCopy> = {
  [ReservationMailEvent.Applied]: {
    subject: "【i-Club 予約システム】施設・設備の利用予約が申請されました",
    opening: "施設・設備の利用予約が申請されました。",
    allowsReason: false,
    includesUnlockNotice: false,
    includesMessage: false,
  },
  [ReservationMailEvent.Withdrawn]: {
    subject: "【i-Club 予約システム】施設・設備の仮予約が取り消されました",
    opening: "申請されていた仮予約が取り消されました。",
    allowsReason: true,
    includesUnlockNotice: false,
    includesMessage: false,
  },
  [ReservationMailEvent.Cancelled]: {
    subject: "【i-Club 予約システム】施設・設備の利用予約がキャンセルされました",
    opening: "承認済みの利用予約がキャンセルされました。",
    allowsReason: true,
    includesUnlockNotice: false,
    includesMessage: false,
  },
  [ReservationMailEvent.Approved]: {
    subject: "【i-Club 予約システム】施設・設備の利用予約が承認されました",
    opening: "申請されていた利用予約が承認されました。",
    allowsReason: false,
    includesUnlockNotice: true,
    includesMessage: true,
  },
  [ReservationMailEvent.Rejected]: {
    subject: "【i-Club 予約システム】施設・設備の利用予約が却下されました",
    opening: "申請されていた利用予約が却下されました。",
    allowsReason: true,
    includesUnlockNotice: false,
    includesMessage: false,
  },
  [ReservationMailEvent.CancelledByStaff]: {
    subject: "【i-Club 予約システム】施設・設備の利用予約が事務局によりキャンセルされました",
    opening: "承認済みの利用予約が事務局によりキャンセルされました。",
    allowsReason: true,
    includesUnlockNotice: false,
    includesMessage: false,
  },
  [ReservationMailEvent.ApprovedEdited]: {
    subject: "【i-Club 予約システム】施設・設備の利用予約の内容が変更されました",
    opening:
      "承認済みの利用予約の内容（使用人数・備考）が変更されました。承認済みのまま変わりません。",
    allowsReason: false,
    includesUnlockNotice: false,
    includesMessage: false,
  },
  [ReservationMailEvent.ReapprovalRequested]: {
    subject: "【i-Club 予約システム】施設・設備の利用予約が変更され、再承認待ちになりました",
    opening:
      "承認済みの利用予約の施設・日時が変更されたため、仮予約に戻りました。事務局が改めて承認するまで、施設・設備は利用できません。",
    allowsReason: false,
    includesUnlockNotice: false,
    includesMessage: false,
  },
  [ReservationMailEvent.ProvisionalEdited]: {
    subject: "【i-Club 予約システム】施設・設備の仮予約の内容が変更されました",
    opening: "申請されていた仮予約の内容が変更されました。",
    allowsReason: false,
    includesUnlockNotice: false,
    includesMessage: false,
  },
  [ReservationMailEvent.EditedByStaff]: {
    subject: "【i-Club 予約システム】施設・設備の利用予約が事務局により変更されました",
    opening: "利用予約の内容が事務局により変更されました。予約の状態は変わりません。",
    allowsReason: false,
    includesUnlockNotice: false,
    includesMessage: false,
  },
};

/** 通知に載せる予約の情報 */
export interface ReservationMailSubject {
  readonly id: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly statusReason: string | null;
  /**
   * 施設の解錠の手配（COND-027 / EVT-005）。
   *
   * 承認通知で案内を載せるのに使う。未定の場合は null。
   */
  readonly unlockArrangement: UnlockArrangement | null;
  /**
   * この通知を出した書き込みで、予約に入れた更新日時。
   *
   * 本文には出さず、idempotencyKey にだけ使う（createReservationMailDrafts を参照）。
   */
  readonly updatedAt: Date;
}

/**
 * イベント種別と予約情報から本文を組み立てる純粋関数。
 * 署名と冒頭以外の骨組みは全イベント共通で、理由・解錠の手配の案内・メッセージの有無だけがイベントと入力値により分岐する。
 * 末尾には、どのイベントでも予約詳細（SCR-005）へのリンクを載せる（EVT-001〜007・EVT-012・EVT-017）。
 * リンクは `area` の画面の予約詳細にする（団体側の宛先は利用者の画面、事務局の宛先は事務局の画面。COND-030 の (5)）。
 */
const buildBody = (
  event: ReservationMailEvent,
  reservation: ReservationMailSubject,
  appBaseUrl: string,
  area: AppArea,
  message: string | null,
): string => {
  const copy = eventMailCopy[event];
  const detailUrl = `${appBaseUrl}${toReservationDetailPath(area, reservation.id)}`;
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

  if (copy.includesUnlockNotice && reservation.unlockArrangement !== null) {
    const notice = unlockArrangementGroupNotice[reservation.unlockArrangement];
    if (notice !== null) {
      lines.push("", notice);
    }
  }

  /*
   * 承認と同時に送ったメッセージ（EVT-005・REQ-048）。解錠の手配の案内の後に置く。
   * 「方法はメッセージを確認してください」の案内のすぐ下に、その方法が読めるようにするため。
   * 送るのは事務局としての送信だけで、宛先はすべて団体側なので、送信者は「事務局」とだけ出す（COND-008）。
   */
  const includesMessage = copy.includesMessage && message !== null;
  if (includesMessage) {
    lines.push("", `${STAFF_SENDER_LABEL}からのメッセージ:`, message);
  }

  lines.push(
    "",
    "予約の詳細は、次のページでご確認ください。",
    // 返信の仕方は、メッセージ通知（EVT-008）と同じく案内する
    ...(includesMessage
      ? ["メッセージへの返信は、このメールではなく次のページから送ってください。"]
      : []),
    detailUrl,
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
 * - 団体の宛先には利用者の画面、事務局宛てには事務局の画面の予約詳細 URL を載せる（COND-030 の (5)）。
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
 * @param appBaseUrl 予約詳細へのリンクを組み立てるための、アプリの URL の起点（例: `https://example.com`）
 * @param message 操作と同時に送ったメッセージの本文（検証済み）。承認通知（EVT-005）にだけ載せ、
 *   ほかのイベントでは渡しても載せない。添えなかったときは null
 * @returns Transactional Outbox に積むための MailDraft の配列
 */
export const createReservationMailDrafts = (
  event: ReservationMailEvent,
  reservation: ReservationMailSubject,
  audience: ReservationMailAudience,
  appBaseUrl: string,
  message: string | null = null,
): readonly MailDraft[] => {
  const copy = eventMailCopy[event];
  /*
   * 本文は宛先の側（団体側・事務局）ごとに 1 回だけ組み立てる。違うのは予約の詳細へのリンクだけで、
   * 団体側には利用者の画面、事務局には事務局の画面を載せる（COND-030 の (5)・ADR-016 決定 17）。
   */
  const toDrafts = (recipients: ReservationMailRecipients, area: AppArea): MailDraft[] => {
    const text = buildBody(event, reservation, appBaseUrl, area, message);
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

  const groupDrafts = toDrafts(audience.groupMembers, AppArea.User);
  return notifiesStaff[event]
    ? [...groupDrafts, ...toDrafts(audience.staff, AppArea.Staff)]
    : groupDrafts;
};
