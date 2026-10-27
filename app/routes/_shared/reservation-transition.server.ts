import type { ReservationTransition } from "~/domain/reservation/transition";
import { parseUnlockArrangement } from "~/domain/reservation/unlock-arrangement";
import type { Database } from "~/infra/db";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationMailRecipientsQuery } from "~/infra/reservation/reservation-mail-recipients-query";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { resolveAppBaseUrl } from "~/lib/app-url.server";
import type { SessionUser } from "~/lib/auth/auth-session.server";
import { changeReservationStatusUseCase } from "~/usecases/reservation/change-reservation-status";

/**
 * 予約の状態を変える操作（承認・却下・取り消し・キャンセル）を、ルートの action から実行する。
 *
 * 予約の詳細・一覧・事務局の一覧・空き状況・ダッシュボードの 5 画面が同じ依存と引数で呼ぶので、組み立てをここにまとめる。
 * どの操作を受け付けるか・失敗したときの見せ方・成功したあとの戻り先は画面ごとに違うので、各ルートに残す。
 */
export const changeReservationStatus = (
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
    readonly now: Date;
    /** 事務局の画面からの操作か（COND-030 の (1)） */
    readonly actsAsStaff: boolean;
  },
) =>
  changeReservationStatusUseCase(
    {
      reservationRepository: createReservationRepository(db),
      membershipRepository: createMembershipRepository(db),
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
      now: input.now,
      appBaseUrl: resolveAppBaseUrl(request),
    },
  );
