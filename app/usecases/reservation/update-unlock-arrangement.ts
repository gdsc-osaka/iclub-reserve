import { createId } from "@paralleldrive/cuid2";
import { errAsync, ok, okAsync, safeTry, type Result, type ResultAsync } from "neverthrow";

import { AuditLogAction, isActedAsStaff, type AuditLogDraft } from "~/domain/audit-log";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import {
  createReservationMessageMailDrafts,
  selectReservationMessageRecipients,
} from "~/domain/mail/reservation-message-mail";
import type { Actor, MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  ReservationErrorCode,
  reservationPermissions,
  type Reservation,
  type ReservationError,
  type ReservationRepository,
  type UnlockArrangement,
} from "~/domain/reservation";
import { toReservationUnlockArrangementChanges } from "~/domain/reservation/audit-log";
import {
  isSentAsStaff,
  validateReservationMessageBody,
  type ReservationMessage,
} from "~/domain/reservation/message";
import { validateUnlockArrangementUpdate } from "~/domain/reservation/unlock-arrangement";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import { requestImmediateDelivery } from "~/usecases/_shared/mail-delivery";
import { toRecipientsError } from "./_shared/mail-recipients";
import { ensureActorCan, resolveReservationActor } from "./_shared/reservation-authorization";

export interface UpdateUnlockArrangementDeps {
  readonly reservationRepository: ReservationRepository;
  readonly membershipRepository: MembershipRepository;
  readonly reservationMailRecipientsQuery: ReservationMailRecipientsQuery;
  readonly mailOutboxNotifier: MailOutboxNotifier;
}

export interface UpdateUnlockArrangementArgs {
  readonly reservationId: string;
  readonly actorUserId: string;
  /** メッセージを添えるときに通知メールへ載せる送信者の氏名（事務局としての送信では本文には出ない） */
  readonly actorName: string;
  /** 事務局の画面からの操作か（COND-030 の (1)） */
  readonly isStaff: boolean;
  /** 画面から届いた解錠の手配（parseUnlockArrangement 済み） */
  readonly unlockArrangement: UnlockArrangement | null;
  /** 画面から届いた未検証のメッセージ本文（任意。空でもよい） */
  readonly message: string;
  readonly now: Date;
  readonly appBaseUrl: string;
}

export interface UpdateUnlockArrangementReturns {
  /** メッセージを添えて送信したか（ルートが既読を進めるかの判定に使う） */
  readonly messageSent: boolean;
}

/**
 * 任意のメッセージ本文を検証・正規化する（COND-023 / UC-038）。
 *
 * 前後の空白を除いて空ならメッセージを添えない（null を返す）。
 * 空でなければ通常のメッセージ送信（UC-009）と同じ検証（validateReservationMessageBody）を通す。
 */
const validateOptionalMessageBody = (raw: string): Result<string | null, ReservationError> =>
  raw.trim() === "" ? ok(null) : validateReservationMessageBody(raw);

/**
 * メッセージを添えるときだけ、メッセージと通知メール（EVT-008）を組み立てる。
 *
 * メッセージを添えないときはメールを送らない（団体はダッシュボードの未読で知る。UC-038）。
 */
const resolveUpdateMessageAndMails = (
  deps: Pick<UpdateUnlockArrangementDeps, "reservationMailRecipientsQuery">,
  args: {
    readonly messageBody: string | null;
    readonly actor: Actor;
    readonly actorUserId: string;
    readonly actorName: string;
    readonly reservation: Pick<Reservation, "id" | "startAt" | "endAt">;
    readonly unlockArrangement: UnlockArrangement;
    readonly now: Date;
    readonly appBaseUrl: string;
  },
): ResultAsync<
  { readonly message: ReservationMessage | null; readonly mails: readonly MailDraft[] },
  ReservationError
> => {
  if (args.messageBody === null) {
    return okAsync({ message: null, mails: [] });
  }

  const sentAsStaff = isSentAsStaff(args.actor);
  const message: ReservationMessage = {
    id: createId(),
    reservationId: args.reservation.id,
    senderId: args.actorUserId,
    sentAsStaff,
    body: args.messageBody,
    sentAt: args.now,
  };

  return deps.reservationMailRecipientsQuery
    .findForMessage(args.reservation.id)
    .mapErr(toRecipientsError)
    .map((audience) => {
      const recipients = selectReservationMessageRecipients(audience, {
        sentAsStaff,
        senderUserId: args.actorUserId,
      });
      const mails = createReservationMessageMailDrafts({
        message,
        reservation: {
          id: args.reservation.id,
          startAt: args.reservation.startAt,
          endAt: args.reservation.endAt,
        },
        senderName: args.actorName,
        recipients,
        appBaseUrl: args.appBaseUrl,
        unlockArrangement: args.unlockArrangement,
      });
      return { message, mails };
    });
};

/**
 * 承認済みの予約の解錠の手配を更新するユースケース（UC-038 / COND-027 (4)）。
 *
 * 任意で団体へのメッセージを添えることができ、添えたときは同じトランザクションで
 * メッセージの記録と通知メール（EVT-008）の outbox 投入を行う（COND-023）。
 * Google Calendar には解錠の手配を載せない（公開範囲外の項目のため。COND-008）ので、
 * カレンダー同期タスクは積まない。
 */
export const updateUnlockArrangementUseCase = (
  deps: UpdateUnlockArrangementDeps,
  args: UpdateUnlockArrangementArgs,
): ResultAsync<UpdateUnlockArrangementReturns, ReservationError> =>
  safeTry(async function* () {
    /*
     * 事務局だけの操作なので、予約を引く前に事務局の画面からの操作かを確かめる。
     * 引いてから確かめると、予約が無い（NotFound）か許されない（Forbidden）かの応答の違いから、
     * 事務局でない人に予約の有無が伝わってしまう（change-reservation-status.ts と同じ理由）。
     */
    yield* ensureActorCan(
      { isStaff: args.isStaff, membership: null },
      ReservationAction.UpdateUnlockArrangement,
      "この操作は、事務局のみ行えます。",
    );

    const reservation = yield* deps.reservationRepository.findById(args.reservationId);

    // 操作する人を組み立てる（事務局の画面からの操作なので所属は読まれない。COND-030 (1)）
    const actor = yield* resolveReservationActor(deps, reservation.groupId, {
      actorUserId: args.actorUserId,
      isStaff: args.isStaff,
    });

    const unlockArrangement = yield* validateUnlockArrangementUpdate(
      reservation,
      args.unlockArrangement,
      args.now,
    );

    const messageBody = yield* validateOptionalMessageBody(args.message);

    const { message, mails } = yield* resolveUpdateMessageAndMails(deps, {
      messageBody,
      actor,
      actorUserId: args.actorUserId,
      actorName: args.actorName,
      reservation,
      unlockArrangement,
      now: args.now,
      appBaseUrl: args.appBaseUrl,
    });

    const auditLog: AuditLogDraft = {
      occurredAt: args.now,
      actorId: args.actorUserId,
      actedAsStaff: isActedAsStaff(
        reservationPermissions,
        actor,
        ReservationAction.UpdateUnlockArrangement,
      ),
      action: AuditLogAction.ReservationUnlockArrangementUpdate,
      targetId: reservation.id,
      groupId: reservation.groupId,
      changes: toReservationUnlockArrangementChanges(reservation, { unlockArrangement }),
    };

    // 解錠の手配は Google Calendar の公開範囲外の項目（COND-008）のため、カレンダー同期は不要
    const outcome = yield* deps.reservationRepository.applyUnlockArrangementUpdate(
      {
        id: reservation.id,
        expectedStatus: reservation.status,
        expectedUpdatedAt: reservation.updatedAt,
        unlockArrangement,
        updatedAt: args.now,
      },
      message,
      mails,
      auditLog,
    );

    if (!outcome.applied) {
      return errAsync<never, ReservationError>({
        code: ReservationErrorCode.Conflict,
        message: `予約 ${reservation.id} は読んだ後に状態か内容が変わっていたので、更新しなかった。`,
        userMessage:
          "この予約には別の操作が先に反映されました。画面を読み込み直して、状態と内容を確認してください。",
      });
    }

    if (outcome.enqueuedMailIds.length > 0) {
      requestImmediateDelivery(deps.mailOutboxNotifier, outcome.enqueuedMailIds);
    }

    return okAsync({ messageSent: message !== null });
  });
