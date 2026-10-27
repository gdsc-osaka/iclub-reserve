import type { ReservationTransition } from "~/domain/reservation/transition";
import { parseUnlockArrangement } from "~/domain/reservation/unlock-arrangement";
import type { Database } from "~/infra/db";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationMailRecipientsQuery } from "~/infra/reservation/reservation-mail-recipients-query";
import { createReservationReadRepository } from "~/infra/reservation/reservation-read-repo";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { resolveAppBaseUrl } from "~/lib/app-url.server";
import type { SessionUser } from "~/lib/auth/auth-session.server";
import { logReservationError } from "~/routes/_shared/reservation-error.server";
import { changeReservationStatusUseCase } from "~/usecases/reservation/change-reservation-status";
import { markReservationReadUseCase } from "~/usecases/reservation/mark-reservation-read";

/**
 * 予約の状態を変える操作（承認・却下・取り消し・キャンセル）を、ルートの action から実行する。
 *
 * 予約の詳細・一覧・事務局の一覧・空き状況・ダッシュボードの 5 画面が同じ依存と引数で呼ぶので、組み立てをここにまとめる。
 * どの操作を受け付けるか・失敗したときの見せ方・成功したあとの戻り先は画面ごとに違うので、各ルートに残す。
 *
 * 承認と同時にメッセージを送ったときは、送った人のその予約を既読にする（UC-009 / COND-026 (5)）。
 * 予約詳細からのメッセージの送信と同じく、失敗しても承認とメッセージは済んでいるので、ログにだけ残して成功を返す。
 * 画面ごとに書くと、どこかの画面で既読にし忘れるので、ここで行う。
 */
export const changeReservationStatus = async (
  db: Database,
  request: Request,
  user: SessionUser,
  input: {
    readonly reservationId: string;
    readonly transition: ReservationTransition;
    /** フォームの `reason` の値。文字列でなければ理由なしとして扱う */
    readonly reason: FormDataEntryValue | null;
    /** フォームの `unlockArrangement` の値。承認のときだけ使う（COND-027） */
    readonly unlockArrangement: FormDataEntryValue | null;
    /** フォームの `message` の値。承認のときだけ使う（REQ-048）。文字列でなければ添えなかったものとして扱う */
    readonly message: FormDataEntryValue | null;
    readonly now: Date;
    /** 事務局の画面からの操作か（COND-030 の (1)） */
    readonly actsAsStaff: boolean;
    /** ログに残す、どの画面のどの操作か。既読にできなかったときのログに使う */
    readonly where: string;
  },
) => {
  const reservationRepository = createReservationRepository(db);
  const membershipRepository = createMembershipRepository(db);

  const result = await changeReservationStatusUseCase(
    {
      reservationRepository,
      membershipRepository,
      reservationMailRecipientsQuery: createReservationMailRecipientsQuery(db),
      mailOutboxNotifier: createQueueMailOutboxNotifier(),
    },
    {
      reservationId: input.reservationId,
      actorUserId: user.id,
      isStaff: input.actsAsStaff,
      transition: input.transition,
      reason: typeof input.reason === "string" ? input.reason : null,
      unlockArrangement: parseUnlockArrangement(input.unlockArrangement),
      message: typeof input.message === "string" ? input.message : null,
      now: input.now,
      appBaseUrl: resolveAppBaseUrl(request),
    },
  );

  if (result.isOk() && result.value.messageId !== null) {
    await markReservationReadUseCase(
      {
        reservationReadRepository: createReservationReadRepository(db),
        reservationRepository,
        membershipRepository,
      },
      {
        reservationId: input.reservationId,
        actorUserId: user.id,
        isStaff: input.actsAsStaff,
        now: input.now,
      },
    ).match(
      () => undefined,
      (error) => logReservationError({ where: `${input.where}.mark-read`, userId: user.id }, error),
    );
  }

  return result;
};
