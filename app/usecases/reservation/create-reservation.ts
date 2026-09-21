import { createId } from "@paralleldrive/cuid2";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import { FacilityErrorCode, type FacilityRepository } from "~/domain/facility";
import { GroupErrorCode, GroupStatus, type GroupRepository } from "~/domain/group";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { createReservationMailDrafts, ReservationMailEvent } from "~/domain/mail/reservation-mail";
import { canPerform, type MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  ReservationErrorCode,
  reservationPermissions,
  ReservationStatus,
  type Reservation,
  type ReservationError,
  type ReservationRepository,
} from "~/domain/reservation";
import { validateReservationDraft } from "~/domain/reservation/validation";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";

export interface CreateProvisionalReservationDeps {
  readonly reservationRepository: ReservationRepository;
  readonly membershipRepository: MembershipRepository;
  /** 申請元の団体が有効かを確かめるために使う（COND-006） */
  readonly groupRepository: GroupRepository;
  /** 申請先の施設・設備が使えるかを確かめるために使う */
  readonly facilityRepository: FacilityRepository;
  /** 申請通知メール（EVT-001）の宛先（申請者・団体管理者全員・事務局）を取得するために使う */
  readonly reservationMailRecipientsQuery: ReservationMailRecipientsQuery;
  /** outbox に積んだメールの即時配送を依頼する先（ADR-002 決定 1） */
  readonly mailOutboxNotifier: MailOutboxNotifier;
}

export interface CreateProvisionalReservationArgs {
  readonly actorUserId: string;
  /** 申請する人が事務局かどうか（COND-009） */
  readonly isStaff: boolean;
  /** 「過去の日時か」を判定する基準になる現在時刻 */
  readonly now: Date;
  readonly reservation: {
    facilityId: string;
    groupId: string;
    startAt: Date;
    endAt: Date;
    headCount: number;
    note: string | null;
  };
}

export interface CreateProvisionalReservationReturns {
  reservationId: string;
}

/**
 * 申請する人がこの団体で仮予約を作れるかを確かめる。
 *
 * 事務局は所属に関わらず全団体の予約を作成できる（COND-009）。
 * この分岐が無いと、団体に所属していない事務局の人が
 * どの団体の予約も作れないことになってしまう。
 */
const ensureCanCreate = (
  deps: CreateProvisionalReservationDeps,
  args: CreateProvisionalReservationArgs,
): ResultAsync<null, ReservationError> => {
  if (args.isStaff) return okAsync(null);

  return deps.membershipRepository
    .findByGroupAndUser(args.reservation.groupId, args.actorUserId)
    .mapErr((error): ReservationError => ({
      code: ReservationErrorCode.DatabaseError,
      message: "所属の確認に失敗しました。",
      cause: error,
    }))
    .andThen((membership) =>
      canPerform(reservationPermissions, membership, ReservationAction.CreateProvisional)
        ? okAsync(null)
        : errAsync({
            code: ReservationErrorCode.ReservationForbidden,
            message: "この団体で予約を申請する権限がありません。",
          } satisfies ReservationError),
    );
};

/**
 * 申請元の団体が有効かを確かめる（COND-006 / STATE-001）。
 *
 * 権限の確認より後に置いている。先にここを通すと、団体に所属していない人が
 * 団体 ID を当てずっぽうに送るだけで「その団体が有効かどうか」を読み取れてしまう。
 */
const ensureGroupIsEnabled = (
  deps: CreateProvisionalReservationDeps,
  groupId: string,
): ResultAsync<null, ReservationError> =>
  deps.groupRepository
    .findById(groupId)
    .mapErr((error): ReservationError =>
      error.code === GroupErrorCode.GroupNotFound
        ? {
            code: ReservationErrorCode.ReservationGroupNotEligible,
            message: "選んだ団体が見つかりません。",
          }
        : {
            code: ReservationErrorCode.DatabaseError,
            message: "団体の確認に失敗しました。",
            cause: error,
          },
    )
    .andThen((group) =>
      group.status === GroupStatus.Enabled
        ? okAsync(null)
        : errAsync({
            code: ReservationErrorCode.ReservationGroupNotEligible,
            message: "予約を申請できるのは、事務局が有効にした団体だけです。",
          } satisfies ReservationError),
    );

/**
 * 申請先の施設・設備が使えるかを確かめる。
 *
 * 画面（SCR-002）の選択肢は有効な施設だけに絞ってあるが、それとは別にここでも確かめる。
 * `facility_id` は POST を組み立てれば自由に送れるので、選択肢だけに頼ると
 * 無効化された施設の予約が作れてしまう。その予約は空き状況カレンダーにも
 * 申請フォームにも出ない（どちらも `is_active` で絞っている）ので、
 * 誰の画面にも現れないまま残り続ける。無効化の条件（COND-003: 将来の予約が
 * すべて終了していること）も、後から予約を足せるなら意味をなさない。
 */
const ensureFacilityIsAvailable = (
  deps: CreateProvisionalReservationDeps,
  facilityId: string,
): ResultAsync<null, ReservationError> =>
  deps.facilityRepository
    .findById(facilityId)
    .mapErr((error): ReservationError =>
      error.code === FacilityErrorCode.FacilityNotFound
        ? {
            code: ReservationErrorCode.ReservationFacilityNotAvailable,
            message: "選んだ施設・設備が見つかりません。",
          }
        : {
            code: ReservationErrorCode.DatabaseError,
            message: "施設・設備の確認に失敗しました。",
            cause: error,
          },
    )
    .andThen((facility) =>
      facility.isActive
        ? okAsync(null)
        : errAsync({
            code: ReservationErrorCode.ReservationFacilityNotAvailable,
            message: "選んだ施設・設備は、いま予約を受け付けていません。",
          } satisfies ReservationError),
    );

/**
 * 同一施設・同一時間帯に承認済みの予約が無いかを確かめる（COND-001）。
 *
 * 確認から作成までの間に別の予約が承認される可能性は残るが、
 * ここで作るのは仮予約なので実害は出ない。承認（UC-006）でも同じ条件を確かめるため、
 * すり抜けた仮予約は承認の段階で止まる。
 */
const ensureNoApprovedOverlap = (
  deps: CreateProvisionalReservationDeps,
  args: CreateProvisionalReservationArgs,
): ResultAsync<null, ReservationError> =>
  deps.reservationRepository
    .existsApprovedOverlap({
      facilityId: args.reservation.facilityId,
      startAt: args.reservation.startAt,
      endAt: args.reservation.endAt,
    })
    .andThen((exists) =>
      exists
        ? errAsync({
            code: ReservationErrorCode.ReservationConflict,
            message:
              "選んだ時間帯には、すでに承認済みの予約が入っています。別の時間帯を選んでください。",
          } satisfies ReservationError)
        : okAsync(null),
    );

/**
 * 仮予約を申請するユースケース（UC-002 / SCR-002）。
 *
 * ステータスは必ず「仮予約」で作る（STATE-001）。引数に status を受け取っていないのは、
 * 申請者が選べてしまう余地を型から無くすため。事務局が承認フローを経ずに
 * 承認済みの予約を直接作る操作（UC-008）は、別のユースケースとして用意すること。
 *
 * 確かめる順序には意味がある。
 *
 * 1. 入力そのもの（利用可能時間・刻み・過去日時・使用人数・備考）— DB を引かずに分かる
 * 2. 権限（COND-009 / 権限表）— 団体の状態を他人に読み取らせないため、団体の確認より先
 * 3. 申請元の団体が有効か（COND-006）
 * 4. 申請先の施設・設備が使えるか
 * 5. 承認済みの予約との重複（COND-001）— 作成の直前に置いて、確認から作成までを短くする
 * 6. 通知先の取得（EVT-001）— 確認がすべて通ったあとに引き、予約の作成と不可分に outbox へ積む（ADR-002 決定 3）
 */
export const createProvisionalReservationUseCase = (
  deps: CreateProvisionalReservationDeps,
  args: CreateProvisionalReservationArgs,
): ResultAsync<CreateProvisionalReservationReturns, ReservationError> => {
  const id = createId();
  const now = args.now;
  const reservation: Reservation = {
    ...args.reservation,
    id,
    status: ReservationStatus.Provisional,
    statusReason: null,
    createdBy: args.actorUserId,
    createdAt: now,
    updatedAt: now,
  };

  return validateReservationDraft(args.reservation, now)
    .asyncAndThen(() => ensureCanCreate(deps, args))
    .andThen(() => ensureGroupIsEnabled(deps, args.reservation.groupId))
    .andThen(() => ensureFacilityIsAvailable(deps, args.reservation.facilityId))
    .andThen(() => ensureNoApprovedOverlap(deps, args))
    .andThen(() =>
      deps.reservationMailRecipientsQuery
        .findForNewReservation({
          groupId: args.reservation.groupId,
          applicantUserId: args.actorUserId,
        })
        .mapErr((error): ReservationError => ({
          code: ReservationErrorCode.DatabaseError,
          message: "通知先メールアドレスの取得に失敗しました。",
          cause: error,
        })),
    )
    .map((audience) =>
      createReservationMailDrafts(
        ReservationMailEvent.Applied,
        {
          id,
          startAt: args.reservation.startAt,
          endAt: args.reservation.endAt,
          statusReason: null,
        },
        audience,
      ),
    )
    .andThen((mails) => deps.reservationRepository.create(reservation, mails))
    .map((outcome) => {
      /*
       * 予約の作成と outbox への追加が不可分に成功したあとにだけ、即時配送を依頼する（ADR-002 決定 1）。
       *
       * 依頼の結果は受け取らない（notifyEnqueued は void）。キューへ届かなくても
       * outbox の行は残り、遅くとも 1 分後に cron が拾うので、業務処理としては成功のまま返す。
       *
       * ポートの取り決めでは notifyEnqueued は例外を投げないが、ここで捕まえておく。
       * 予約の作成はすでに確定しているので、通知の都合で画面にエラーを出すと
       * 利用者は「失敗した」と思って同じ内容をもう一度申請してしまう。
       */
      try {
        deps.mailOutboxNotifier.notifyEnqueued(outcome.enqueuedMailIds);
      } catch (error) {
        console.error("Failed to request immediate mail delivery:", error);
      }

      return { reservationId: id };
    });
};
