import { ok, safeTry, type ResultAsync } from "neverthrow";

import type { ReservationError, UnlockArrangement } from "~/domain/reservation";
import {
  canPerformTransition,
  ReservationTransition,
  validateTransitionReason,
} from "~/domain/reservation/transition";
import {
  changeReservationStatusUseCase,
  type ChangeReservationStatusDeps,
  type ChangeReservationStatusResult,
} from "./change-reservation-status";

/** 重なりの解決の依存。承認・却下のユースケースをそのまま呼ぶので、依存も同じ */
export type ResolveProvisionalOverlapDeps = ChangeReservationStatusDeps;

export interface ResolveProvisionalOverlapArgs {
  /** 承認する仮予約の ID */
  readonly reservationId: string;
  /** 画面で「却下する」と示した仮予約の ID（未検証。重なっているかはユースケースが確かめる） */
  readonly rejectReservationIds: readonly string[];
  readonly actorUserId: string;
  /** 事務局の画面からの操作か（COND-030 の (1)） */
  readonly isStaff: boolean;
  /** 却下の理由（未検証。COND-002）。却下するすべての予約に同じ理由を使う */
  readonly reason?: string | null;
  /** 承認する予約の解錠の手配（COND-027） */
  readonly unlockArrangement?: UnlockArrangement | null;
  /** 承認と同時に送るメッセージ（未検証。COND-023） */
  readonly message?: string | null;
  readonly now?: Date;
  readonly appBaseUrl: string;
}

export interface ResolveProvisionalOverlapResult {
  /** 承認の結果 */
  readonly approval: ChangeReservationStatusResult;
  /** 却下できた予約の ID */
  readonly rejectedReservationIds: readonly string[];
  /** 却下しなかった予約と、その理由（COND-031 (5)）。ルートがログに残す */
  readonly skipped: readonly { readonly reservationId: string; readonly error: ReservationError }[];
}

/**
 * 同じ施設・時間帯に重なった仮予約を、事務局が 1 回の操作で解決するユースケース（COND-031）。
 *
 * 【確定の順序（COND-031 (5)）】
 * 先に承認する。承認できなかったとき（COND-001 や、ほかの操作が先に反映されたとき）は、何も却下しない。
 * 承認できたら、却下するものを 1 件ずつ却下する。画面を開いた後に団体が施設・日時を変えたり取り消したりして、
 * 却下できなくなったものや、承認したものと重ならなくなったものは、却下せずに残す。残ったものが承認したものと
 * まだ重なっていれば、一覧に承認できない旨が出るので（COND-001）、事務局が改めて却下できる。
 *
 * 承認とすべての却下を 1 つの書き込み（db.batch）にまとめないのは、却下はそれぞれが通知と操作履歴を持つ別の操作で、
 * 却下できなかったものが残っても、承認したことは変わらないためである。
 */
export const resolveProvisionalOverlapUseCase = (
  deps: ResolveProvisionalOverlapDeps,
  args: ResolveProvisionalOverlapArgs,
): ResultAsync<ResolveProvisionalOverlapResult, ReservationError> =>
  safeTry(async function* () {
    const now = args.now ?? new Date();

    /*
     * 予約を引く前に、事務局かどうかを確かめる（change-reservation-status.ts と同じ理由）。
     * 引いてから確かめると、NotFound か Forbidden かの違いで、事務局でない人に予約の有無が伝わってしまうためである。
     */
    yield* canPerformTransition(ReservationTransition.Approve, {
      isStaff: args.isStaff,
      membership: null,
    });

    // 却下する ID から、重複と、承認する予約自身を除く
    const targetRejectIds = [
      ...new Set(args.rejectReservationIds.filter((id) => id !== args.reservationId)),
    ];

    /*
     * 却下するものが 1 件以上あれば、何かを書く前に理由を確かめる（COND-002）。
     * 承認した後に理由の不備で却下が全部止まるのを防ぐためである。1 件も無ければ理由は読まない。
     */
    const validatedRejectReason =
      targetRejectIds.length > 0
        ? yield* validateTransitionReason(ReservationTransition.Reject, args.reason)
        : null;

    // 承認した後に重なりを確かめるのに施設と時間帯を使うため、予約を引いておく（承認で施設・時間帯は変わらない）
    const reservation = yield* deps.reservationRepository.findById(args.reservationId);

    // 先に承認する。失敗したらそのまま返し、何も却下しない（COND-031 (5)）
    const approval = yield* changeReservationStatusUseCase(deps, {
      reservationId: args.reservationId,
      actorUserId: args.actorUserId,
      isStaff: args.isStaff,
      transition: ReservationTransition.Approve,
      reason: null,
      unlockArrangement: args.unlockArrangement,
      message: args.message,
      now,
      appBaseUrl: args.appBaseUrl,
    });

    // 却下するものを 1 件ずつ順に却下する。失敗しても止めずに skipped に積む
    const rejectedReservationIds: string[] = [];
    const skipped: { readonly reservationId: string; readonly error: ReservationError }[] = [];

    for (const rejectId of targetRejectIds) {
      const rejectResult = await changeReservationStatusUseCase(deps, {
        reservationId: rejectId,
        actorUserId: args.actorUserId,
        isStaff: args.isStaff,
        transition: ReservationTransition.Reject,
        reason: validatedRejectReason,
        rejectOnlyIfOverlapping: reservation,
        now,
        appBaseUrl: args.appBaseUrl,
      });

      rejectResult.match(
        () => rejectedReservationIds.push(rejectId),
        (error) => skipped.push({ reservationId: rejectId, error }),
      );
    }

    return ok({ approval, rejectedReservationIds, skipped });
  });
