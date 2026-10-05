import { createId } from "@paralleldrive/cuid2";
import { okAsync, safeTry, type ResultAsync } from "neverthrow";

import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import {
  createReservationMessageMailDrafts,
  selectReservationMessageRecipients,
} from "~/domain/mail/reservation-message-mail";
import type { MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  type ReservationError,
  type ReservationRepository,
} from "~/domain/reservation";
import {
  isSentAsStaff,
  validateReservationMessageBody,
  type ReservationMessage,
  type ReservationMessageRepository,
} from "~/domain/reservation/message";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import { requestImmediateDelivery } from "~/usecases/_shared/mail-delivery";
import { toRecipientsError } from "./_shared/mail-recipients";
import {
  ensureActorCan,
  ensureCanViewReservation,
  resolveReservationActorWithMembership,
} from "./_shared/reservation-authorization";

export interface SendReservationMessageDeps {
  /** 予約の読み取り（findById）に使用 */
  readonly reservationRepository: ReservationRepository;
  readonly membershipRepository: MembershipRepository;
  readonly reservationMessageRepository: ReservationMessageRepository;
  readonly reservationMailRecipientsQuery: ReservationMailRecipientsQuery;
  readonly mailOutboxNotifier: MailOutboxNotifier;
}

export interface SendReservationMessageArgs {
  readonly reservationId: string;
  readonly actorUserId: string;
  /** 通知メールに載せる送信者の氏名。事務局としての送信では使わない */
  readonly actorName: string;
  readonly isStaff: boolean;
  /** 画面から届いた未検証の本文 */
  readonly body: string;
  readonly now: Date;
  readonly appBaseUrl: string;
}

export interface SendReservationMessageReturns {
  readonly messageId: string;
}

/**
 * 予約にメッセージを送信するユースケース（UC-009 / SCR-005）。
 *
 * 【業務ルール・設計上のポイント（COND-023 / EVT-008）】
 * 1. 予約の状態・日時・団体の状態を問わない（COND-023）：
 *    却下された予約の理由についての問い合わせや、利用終了後の鍵返却・備品破損の報告など、
 *    予約に関するあらゆるやり取りを予約単位で完結できるようにするため、
 *    予約のステータス（仮予約・承認済み・却下・取り消し・キャンセル）、利用日時（過去日時含む）、
 *    および団体の有効状態（無効化済み含む）は一切確かめない。
 * 2. 予約の updated_at を更新しない：
 *    メッセージの送信は予約自体の内容変更ではない。予約のステータス変更や内容変更が用いる
 *    楽観的ロック（expectedUpdatedAt）をメッセージ送信で破壊しないため、予約テーブルの更新は行わない。
 * 3. 送信権限と入力検証の順序：
 *    権限の確認を本文の検証より先に行う。権限の無い相手に入力エラーを返さず、
 *    「この予約にはメッセージを送れません。」と答えてアクセスを遮断するため。
 * 4. 事務局所属の確認：
 *    事務局員がその団体のメンバーである場合は団体側としての送信（sent_as_staff = false）となるため、
 *    事務局であっても必ず団体メンバーシップを取得する。
 */
export const sendReservationMessageUseCase = (
  deps: SendReservationMessageDeps,
  args: SendReservationMessageArgs,
): ResultAsync<SendReservationMessageReturns, ReservationError> =>
  safeTry(async function* () {
    // 1. 予約を読む（存在しなければ NotFound をそのまま返す）
    const reservation = yield* deps.reservationRepository.findById(args.reservationId);

    // 2. 操作する人を組み立てる（事務局でも所属を必ず引く）
    const actor = yield* resolveReservationActorWithMembership(deps, reservation.groupId, {
      actorUserId: args.actorUserId,
      isStaff: args.isStaff,
    });

    // 3. 予約を開いてよいか（可視範囲）を確認
    yield* ensureCanViewReservation(actor);

    // 4. メッセージ送信権限（自団体のメンバーまたは事務局）を確認
    yield* ensureActorCan(
      actor,
      ReservationAction.SendMessage,
      "この予約にはメッセージを送れません。",
    );

    // 5. 本文の検証と正規化（権限確認の後に配置し、権限のない人に入力エラーを漏らさない）
    const normalizedBody = yield* validateReservationMessageBody(args.body);

    // 6. 事務局としての送信か判定（その団体に所属しない事務局のみ true）
    const sentAsStaff = isSentAsStaff(actor);

    // 7. 通知先の候補を引く（EVT-008）
    const audience = yield* deps.reservationMailRecipientsQuery
      .findForMessage(reservation.id)
      .mapErr(toRecipientsError);

    // 8. 宛先を選定（送信者本人の除外、重複除去、ソート）
    const recipients = selectReservationMessageRecipients(audience, {
      sentAsStaff,
      senderUserId: args.actorUserId,
    });

    // 9. メッセージモデルを組み立てる
    const messageId = createId();
    const message: ReservationMessage = {
      id: messageId,
      reservationId: reservation.id,
      senderId: args.actorUserId,
      sentAsStaff,
      body: normalizedBody,
      sentAt: args.now,
    };

    // 10. 通知メール（MailDraft）を作成
    const mails = createReservationMessageMailDrafts({
      message,
      reservation: {
        id: reservation.id,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
      },
      senderName: args.actorName,
      recipients,
      appBaseUrl: args.appBaseUrl,
    });

    // 11. メッセージと outbox を同一バッチで作成（予約行の updated_at は変えない）
    const outcome = yield* deps.reservationMessageRepository.create(message, mails);

    // 12. 即時配送を依頼
    requestImmediateDelivery(deps.mailOutboxNotifier, outcome.enqueuedMailIds);

    // 13. 成功結果を返す
    return okAsync({ messageId });
  });
