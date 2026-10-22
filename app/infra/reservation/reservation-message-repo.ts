import { ResultAsync } from "neverthrow";

import { reservationMessageTable } from "~/db/schema";
import { wrapError } from "~/domain/error";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import { ReservationErrorCode, type ReservationError } from "~/domain/reservation";
import type {
  CreateReservationMessageOutcome,
  ReservationMessage,
  ReservationMessageRepository,
} from "~/domain/reservation/message";
import type { Database } from "../db";
import { mailOutboxInserts } from "../mail/mail-outbox-writes";

/**
 * 予約メッセージリポジトリの生成。
 *
 * メッセージの保存と通知メールの outbox 書き込みを同じ db.batch で原子的に行う（ADR-002）。
 * メッセージの送信は予約自体の更新ではないため、予約テーブルの行（updated_at 等）には触らない。
 */
export const createReservationMessageRepository = (db: Database): ReservationMessageRepository => {
  const create = (
    message: ReservationMessage,
    mails: readonly MailDraft[],
  ): ResultAsync<CreateReservationMessageOutcome, ReservationError> => {
    const insertMessageQuery = db.insert(reservationMessageTable).values(message);

    if (mails.length === 0) {
      return ResultAsync.fromPromise(
        insertMessageQuery,
        wrapError(ReservationErrorCode.DatabaseError, "予約メッセージを書き込めなかった。"),
      ).map(() => ({ enqueuedMailIds: [] }));
    }

    const outbox = mailOutboxInserts(db, mails);

    return ResultAsync.fromPromise(
      db.batch([insertMessageQuery, ...outbox.statements]),
      wrapError(
        ReservationErrorCode.DatabaseError,
        "予約メッセージと通知の outbox を書き込めなかった。",
      ),
    ).map(() => ({
      enqueuedMailIds: outbox.ids,
    }));
  };

  return { create };
};
