import { err, ok, type Result, type ResultAsync } from "neverthrow";

import type { MailDraft } from "../mail/mail-outbox";
import type { Actor } from "../membership";
import { ReservationErrorCode, ReservationField, type ReservationError } from "./index";

/** メッセージ本文の最大文字数（コードポイント単位、COND-023）。 */
export const RESERVATION_MESSAGE_BODY_MAX_LENGTH = 2000;

/** 団体側に見せる、事務局としての送信の送信者の表示（COND-008）。 */
export const STAFF_SENDER_LABEL = "事務局";

/**
 * メッセージの送信者表示文字列を決定する純粋関数（COND-008）。
 *
 * - sentAsStaff が false:
 *   送信者の氏名（見る人が事務局でもそうでなくても同じ）。
 * - sentAsStaff が true:
 *   - 事務局でない人（団体側）が見る場合:
 *     事務局員の個人を特定できないよう、「事務局」とだけ表示する。
 *   - 事務局が見る場合:
 *     どの送信が団体側に「事務局」として見えているかを把握できるようにするため、
 *     「<氏名>（事務局）」の形式で表示する。
 *
 * ※ 見ている人が事務局かどうかは viewer.isStaff で判断する（団体に所属している事務局員も事務局として扱う）。
 */
export const toMessageSenderLabel = (
  message: { readonly sentAsStaff: boolean; readonly senderName: string },
  viewer: { readonly isStaff: boolean },
): string => {
  if (!message.sentAsStaff) {
    return message.senderName;
  }
  if (!viewer.isStaff) {
    return STAFF_SENDER_LABEL;
  }
  return `${message.senderName}（${STAFF_SENDER_LABEL}）`;
};

/**
 * 予約へのメッセージ（INFO-004）。
 *
 * 追記のみで編集・削除は行わない（COND-023）。
 */
export interface ReservationMessage {
  readonly id: string;
  readonly reservationId: string;
  readonly senderId: string;
  readonly sentAsStaff: boolean;
  readonly body: string;
  readonly sentAt: Date;
}

/**
 * 送信者が「事務局として」メッセージを送信したかを判定する純粋関数。
 *
 * INFO-004.sent_as_staff の定義どおり、
 * 事務局の横断権限（COND-009）によって初めて許された送信であれば true。
 * 送信者が事務局で、かつその予約の団体に所属していないときだけ true となる。
 * 団体に所属している事務局員が送った場合は false（団体側としての送信）となる。
 */
export const isSentAsStaff = (actor: Actor): boolean => actor.isStaff && actor.membership === null;

/**
 * メッセージ本文の入力を検証・正規化する（COND-023）。
 *
 * 1. 改行を LF（\n）に統一（\r\n および \r を \n に置換）。
 * 2. 前後の空白（全角空白および改行を含む）を trim() で取り除く。
 * 3. 途中の改行はそのまま保持する。
 * 4. 文字数は正規化後の文字列の Unicode コードポイント数で数え、1 文字以上 2000 文字以下であること。
 *
 * ※ ログ（message）には利用者の入力本文を埋め込まないこと（ADR-004）。
 */
export const validateReservationMessageBody = (raw: string): Result<string, ReservationError> => {
  const normalized = raw.replace(/\r\n|\r/g, "\n").trim();
  const codePointLength = [...normalized].length;

  if (codePointLength === 0) {
    return err({
      code: ReservationErrorCode.InvalidInput,
      field: ReservationField.MessageBody,
      message: "メッセージ本文が空である。",
      userMessage: "メッセージを入力してください。",
    });
  }

  if (codePointLength > RESERVATION_MESSAGE_BODY_MAX_LENGTH) {
    return err({
      code: ReservationErrorCode.InvalidInput,
      field: ReservationField.MessageBody,
      message: `メッセージ本文が${RESERVATION_MESSAGE_BODY_MAX_LENGTH}文字を超えている。`,
      userMessage: `メッセージは${RESERVATION_MESSAGE_BODY_MAX_LENGTH}文字以内で入力してください。`,
    });
  }

  return ok(normalized);
};

/** メッセージ作成の実行結果 */
export interface CreateReservationMessageOutcome {
  /** この操作で outbox に積んだメールの ID。Queues への即時配送依頼に使う */
  readonly enqueuedMailIds: readonly string[];
}

/**
 * メッセージの永続化層に対する窓口（ポート）。
 */
export interface ReservationMessageRepository {
  /**
   * メッセージの行と通知メールを同じ db.batch で作成する。
   * 予約の行（updated_at 等）には触らない。
   */
  create(
    message: ReservationMessage,
    mails: readonly MailDraft[],
  ): ResultAsync<CreateReservationMessageOutcome, ReservationError>;
}
