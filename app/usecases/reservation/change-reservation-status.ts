import { errAsync, okAsync, ResultAsync } from "neverthrow";

import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { createReservationMailDrafts, transitionMailEvent } from "~/domain/mail/reservation-mail";
import {
  ReservationErrorCode,
  ReservationStatus,
  type ReservationError,
  type ReservationRepository,
} from "~/domain/reservation";
import {
  canTransition,
  ReservationTransition,
  transitionSourceStatus,
  transitionTargetStatus,
  validateTransitionReason,
  type ReservationActor,
} from "~/domain/reservation/transition";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import type { UserGroupListQuery } from "~/query/user/user-group-list";

/** 予約ステータス変更ユースケースの依存 */
export interface ChangeReservationStatusDeps {
  readonly reservationRepository: ReservationRepository;
  /** 操作者が予約の団体に所属しているかを検証するためのクエリ */
  readonly userGroupListQuery: UserGroupListQuery;
  /** 状態変更通知メールの宛先を取得するためのクエリ */
  readonly reservationMailRecipientsQuery: ReservationMailRecipientsQuery;
  /** outbox に積んだメールの即時配送を依頼する先（ADR-002 決定 1） */
  readonly mailOutboxNotifier: MailOutboxNotifier;
}

/** 予約ステータス変更ユースケースの引数 */
export interface ChangeReservationStatusArgs {
  /** 操作対象の予約 ID */
  readonly reservationId: string;
  /** 操作を実行するユーザーの ID */
  readonly actorUserId: string;
  /** 操作ユーザーが事務局スタッフかどうか（COND-009） */
  readonly isStaff: boolean;
  /** 実行する状態遷移操作 */
  readonly transition: ReservationTransition;
  /** 操作の理由（却下・事務局キャンセルは必須、取り消し・キャンセルは任意） */
  readonly reason?: string | null;
  /** 更新日時の基準となる日時（テスト容易化のため任意指定可能） */
  readonly now?: Date;
}

/** 予約ステータス変更ユースケースの返却値 */
export interface ChangeReservationStatusResult {
  readonly reservationId: string;
  readonly status: ReservationStatus;
  readonly statusReason: string | null;
}

/**
 * 予約のステータスを変更するユースケース（UC-003 / UC-004 / UC-006 / UC-007）。
 *
 * 【処理の流れ】
 * 1. 予約を ID で取得する（見つからなければ NOT_FOUND）。
 * 2. 操作ユーザーの所属団体を取得し、予約の団体（groupId）に所属しているかを検証する（自団体の突き合わせ）。
 * 3. ドメイン層の純粋関数 `canTransition` / `validateTransitionReason` により、現在のステータス・権限・理由の妥当性を検証する（COND-002）。
 * 4. 承認（approve）の場合は、同一施設・同一時間帯に別の承認済み予約が存在しないか重複確認を行う（COND-001）。
 *    また、承認通知（EVT-005）の宛先（申請者＋団体管理者）を取得し、MailDraft[] を組み立てる。
 * 5. リポジトリを通じてステータス・理由・更新日時、およびメール送信 outbox を永続化する。このとき「読んだときの
 *    状態から変わっていないこと」（承認では重なりが無いことも）を更新の条件に入れ、
 *    同時に実行された別の操作を上書きしないようにする。
 * 6. 更新に成功したら、積んだメールの即時配送を依頼する（ADR-002 決定 1）。依頼はあくまで近道で、
 *    届かなくても cron が拾うため、依頼の成否はこのユースケースの戻り値に影響しない。
 */
export const changeReservationStatusUseCase = (
  deps: ChangeReservationStatusDeps,
  args: ChangeReservationStatusArgs,
): ResultAsync<ChangeReservationStatusResult, ReservationError> => {
  const now = args.now ?? new Date();

  return deps.reservationRepository.findById(args.reservationId).andThen((reservation) =>
    deps.userGroupListQuery
      .findByUserId(args.actorUserId)
      .mapErr((error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "所属団体の確認に失敗しました。",
        cause: error,
      }))
      .andThen((userGroups) => {
        /*
         * 予約の団体での所属を組み立てる。所属していなければ null。
         * 役割（管理者・メンバー）まで持たせているのは、取り消し・キャンセルの可否を
         * ドメインの権限表（reservationPermissions）で判定するため。
         */
        const group = userGroups.find((candidate) => candidate.id === reservation.groupId);
        const actor: ReservationActor = {
          isStaff: args.isStaff,
          membership:
            group === undefined
              ? null
              : { groupId: group.id, userId: args.actorUserId, roles: group.roles },
        };

        // 状態遷移と権限、および理由（COND-002）のドメイン検証
        const transitionCheck = canTransition(reservation, args.transition, actor, args.reason);
        if (transitionCheck.isErr()) {
          return errAsync(transitionCheck.error);
        }

        const reasonResult = validateTransitionReason(args.transition, args.reason);
        if (reasonResult.isErr()) {
          return errAsync(reasonResult.error);
        }
        const statusReason = reasonResult.value;

        // 承認時は重複チェック（COND-001）
        const overlapCheck =
          args.transition === ReservationTransition.Approve
            ? deps.reservationRepository
                .existsApprovedOverlap({
                  facilityId: reservation.facilityId,
                  startAt: reservation.startAt,
                  endAt: reservation.endAt,
                })
                .andThen((exists) =>
                  exists
                    ? errAsync<null, ReservationError>({
                        code: ReservationErrorCode.ReservationConflict,
                        message:
                          "同一施設・同一時間帯に別の承認済み予約が存在します。先にそちらをキャンセルしてください。",
                      })
                    : okAsync(null),
                )
            : okAsync(null);

        // 状態変更通知メール（EVT-002/003/005/006/007）を組み立てる
        const event = transitionMailEvent[args.transition];
        const mailDraftsCheck = deps.reservationMailRecipientsQuery
          .findByReservationId(reservation.id)
          .mapErr((error): ReservationError => ({
            code: ReservationErrorCode.DatabaseError,
            message: "通知先メールアドレスの取得に失敗しました。",
            cause: error,
          }))
          .map((audience) =>
            createReservationMailDrafts(
              event,
              {
                id: reservation.id,
                startAt: reservation.startAt,
                endAt: reservation.endAt,
                statusReason,
              },
              audience,
            ),
          );

        const targetStatus = transitionTargetStatus[args.transition];

        /*
         * 最後の更新は、ここまでの確認結果に頼らず条件付きで行う。
         * findById から更新までの間に別の操作が割り込むことがあり（例: 重なった
         * 仮予約を 2 人の事務局が同時に承認する）、D1 では確認と更新を 1 つの
         * トランザクションで囲めないため、条件を UPDATE 文の中に持ち込む。
         *
         * 状態変更通知メールがある場合は、UPDATE と不可分に outbox へ積むため
         * applyStatusTransition の第 2 引数に渡す（ADR-002 決定 3）。
         */
        return ResultAsync.combine([overlapCheck, mailDraftsCheck]).andThen(([, mailDrafts]) =>
          deps.reservationRepository
            .applyStatusTransition(
              {
                id: reservation.id,
                expectedStatus: transitionSourceStatus[args.transition],
                status: targetStatus,
                statusReason,
                updatedAt: now,
                requireNoApprovedOverlap: args.transition === ReservationTransition.Approve,
              },
              mailDrafts,
            )
            .andThen((outcome) => {
              if (!outcome.applied) {
                return errAsync<ChangeReservationStatusResult, ReservationError>({
                  code: ReservationErrorCode.ReservationConflict,
                  message:
                    "この予約には別の操作が先に反映されました。画面を読み込み直して、状態を確認してください。",
                });
              }

              /*
               * 更新と outbox への追加が不可分に成功したあとにだけ、即時配送を依頼する（ADR-002 決定 1）。
               * 競合で 0 件更新だったときは outbox にも積まれていないため、ここへは来ない。
               *
               * 依頼の結果は受け取らない（notifyEnqueued は void）。キューへ届かなくても
               * outbox の行は残り、遅くとも 1 分後に cron が拾うので、業務処理としては成功のまま返す。
               *
               * ポートの取り決めでは notifyEnqueued は例外を投げないが、ここで捕まえておく。
               * 予約の更新はすでに確定しているので、通知の都合で画面にエラーを出すと
               * 利用者は「失敗した」と思って同じ操作をやり直し、今度は競合で弾かれる。
               */
              try {
                deps.mailOutboxNotifier.notifyEnqueued(outcome.enqueuedMailIds);
              } catch (error) {
                console.error("Failed to request immediate mail delivery:", error);
              }

              return okAsync<ChangeReservationStatusResult, ReservationError>({
                reservationId: reservation.id,
                status: targetStatus,
                statusReason,
              });
            }),
        );
      }),
  );
};
