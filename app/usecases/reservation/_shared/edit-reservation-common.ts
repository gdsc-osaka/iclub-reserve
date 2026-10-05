import { okAsync, ResultAsync } from "neverthrow";

import type { MailDraft } from "~/domain/mail/mail-outbox";
import {
  createReservationMailDrafts,
  type ReservationMailEvent,
} from "~/domain/mail/reservation-mail";
import { ReservationErrorCode, type ReservationError } from "~/domain/reservation";
import type { ReservationContent } from "~/domain/reservation/edit";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import { ensureNoApprovedOverlap, type ApprovedOverlapDeps } from "./approved-overlap";
import { toRecipientsError } from "./mail-recipients";

/*
 * 予約の内容の変更のうち、団体の変更（UC-005 / UC-017）と事務局の直接変更（UC-008）で
 * 同じになる部分をまとめたファイル。違うのは「誰が変えられるか」「変更後のステータス」
 * 「重なったときの文言」「通知のイベント」だけで、それらは引数で受け取る。
 */

/** 重なりの確認と変更通知の組み立てに必要な依存 */
export interface ResolveEditOverlapAndMailsDeps extends ApprovedOverlapDeps {
  readonly reservationMailRecipientsQuery: ReservationMailRecipientsQuery;
}

/** 重なりの確認と変更通知の組み立ての引数 */
export interface ResolveEditOverlapAndMailsArgs {
  readonly reservationId: string;
  /** 変更後の内容。通知には変更後の日時を載せる */
  readonly content: ReservationContent;
  /** 予約に入れる更新日時。通知の idempotencyKey にも使う */
  readonly now: Date;
  /** 承認済みの予約との重なり（COND-001）を確かめるか。施設・日時を変えたときだけ確かめる */
  readonly checksOverlap: boolean;
  /** 重なったときに利用者へ出す文言 */
  readonly overlapUserMessage: string;
  /** 送る変更通知のイベント */
  readonly mailEvent: ReservationMailEvent;
}

/**
 * 承認済みの予約との重なりを確かめ、変更通知のメールを組み立てる（UC-005 / UC-008 / UC-017）。
 *
 * どちらも D1 への往復なので、ResultAsync.combine で同時に投げる。順に待つとそのまま待ち時間になる。
 * 重なりはここで確かめたあとも、書き込みの UPDATE 文の条件で改めて防ぐ（applyContentEdit）。
 */
export const resolveEditOverlapAndMails = (
  deps: ResolveEditOverlapAndMailsDeps,
  args: ResolveEditOverlapAndMailsArgs,
): ResultAsync<readonly MailDraft[], ReservationError> => {
  const overlapCheck = args.checksOverlap
    ? ensureNoApprovedOverlap(
        deps,
        { ...args.content, excludeReservationId: args.reservationId },
        args.overlapUserMessage,
      )
    : okAsync<null, ReservationError>(null);

  const mailDraftsCheck = deps.reservationMailRecipientsQuery
    .findByReservationId(args.reservationId)
    .mapErr(toRecipientsError)
    .map((audience) =>
      createReservationMailDrafts(
        args.mailEvent,
        {
          id: args.reservationId,
          startAt: args.content.startAt,
          endAt: args.content.endAt,
          statusReason: null,
          updatedAt: args.now,
        },
        audience,
      ),
    );

  return ResultAsync.combine([overlapCheck, mailDraftsCheck]).map(([, mailDrafts]) => mailDrafts);
};

/**
 * 内容の更新が 0 件だった（競合した）ときのエラーを組み立てる。
 *
 * 0 件になる原因は、読んだ後に別の人が変更・承認したことと、変更先の時間帯が埋まったことの 2 つで、
 * どちらだったかは UPDATE の結果からは見分けられない。そのため利用者には読み込み直しを促す。
 */
export const toEditConflictError = (reservationId: string): ReservationError => ({
  code: ReservationErrorCode.Conflict,
  message: `予約 ${reservationId} は読んだ後に変わっていたか、変更先の時間帯が埋まったので、更新しなかった。`,
  userMessage:
    "この予約には別の操作が先に反映されました。画面を読み込み直して、内容を確認してください。",
});
