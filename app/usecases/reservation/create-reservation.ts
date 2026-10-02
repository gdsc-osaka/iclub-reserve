import { createId } from "@paralleldrive/cuid2";
import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import { FacilityErrorCode, type FacilityRepository } from "~/domain/facility";
import { GroupErrorCode, GroupStatus, type GroupRepository } from "~/domain/group";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import { createReservationMailDrafts, ReservationMailEvent } from "~/domain/mail/reservation-mail";
import type { MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  ReservationErrorCode,
  ReservationField,
  ReservationStatus,
  type Reservation,
  type ReservationError,
  type ReservationRepository,
} from "~/domain/reservation";
import { validateReservationDraft } from "~/domain/reservation/validation";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import { requestImmediateDelivery } from "~/usecases/_shared/mail-delivery";
import { ensureNoApprovedOverlap } from "./_shared/approved-overlap";
import { toRecipientsError } from "./_shared/mail-recipients";
import { ensureReservationPermission } from "./_shared/reservation-authorization";

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
      error.code === GroupErrorCode.NotFound
        ? {
            code: ReservationErrorCode.GroupNotEligible,
            field: ReservationField.Group,
            message: `申請元の団体 ${groupId} が見つからない。`,
            userMessage: "選んだ団体が見つかりません。",
          }
        : {
            code: ReservationErrorCode.DatabaseError,
            message: "申請元の団体を読み取れなかった。",
            cause: error,
          },
    )
    .andThen((group) =>
      group.status === GroupStatus.Enabled
        ? okAsync(null)
        : errAsync({
            code: ReservationErrorCode.GroupNotEligible,
            field: ReservationField.Group,
            message: `申請元の団体 ${groupId} が有効でない (${group.status})。`,
            userMessage: "予約を申請できるのは、事務局が有効にした団体だけです。",
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
      error.code === FacilityErrorCode.NotFound
        ? {
            code: ReservationErrorCode.FacilityNotAvailable,
            field: ReservationField.Facility,
            message: `申請先の施設 ${facilityId} が見つからない。`,
            userMessage: "選んだ施設・設備が見つかりません。",
          }
        : {
            code: ReservationErrorCode.DatabaseError,
            message: "申請先の施設を読み取れなかった。",
            cause: error,
          },
    )
    .andThen((facility) =>
      facility.isActive
        ? okAsync(null)
        : errAsync({
            code: ReservationErrorCode.FacilityNotAvailable,
            field: ReservationField.Facility,
            message: `申請先の施設 ${facilityId} が無効になっている。`,
            userMessage: "選んだ施設・設備は、いま予約を受け付けていません。",
          } satisfies ReservationError),
    );

/**
 * 仮予約を申請するユースケース（UC-002 / SCR-002）。
 *
 * ステータスは必ず「仮予約」で作る（STATE-001）。引数に status を受け取っていないのは、
 * 申請者が選べてしまう余地を型から無くすため。事務局が承認フローを経ずに
 * 承認済みの予約を直接作る操作（UC-008）は、別のユースケースとして用意すること。
 *
 * 【確かめる順序の理由】
 * DB を引かずに分かる入力の検証を先に、権限をその次に置く。権限を団体の確認より先に
 * 置かないと、団体に所属していない人が団体 ID を当てずっぽうに送るだけで
 * 「その団体が有効かどうか」を読み取れてしまう。
 * 重複の確認（COND-001）は作成の直前に置き、確認から作成までを短くする。
 * 通知先の取得（EVT-001）は確認がすべて通ったあとに引き、予約の作成と不可分に
 * outbox へ積む（ADR-002 決定 3）。
 *
 * 権限の確認では、事務局は所属を引かずに通る。権限表の事務局の行に仮予約の申請が
 * 入っているので（COND-009）、団体での役割を足しても結果が変わらないため。
 * この省略は resolveReservationActor が表から導いている。
 *
 * 各ステップを動かしてよいかは、それぞれの関数のコメントに書いてある。
 */
export const createProvisionalReservationUseCase = (
  deps: CreateProvisionalReservationDeps,
  args: CreateProvisionalReservationArgs,
): ResultAsync<CreateProvisionalReservationReturns, ReservationError> =>
  safeTry(async function* () {
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

    yield* validateReservationDraft(args.reservation, now);
    yield* ensureReservationPermission(
      deps,
      args.reservation.groupId,
      args,
      ReservationAction.CreateProvisional,
      "この団体で予約を申請する権限がありません。",
    );
    yield* ensureGroupIsEnabled(deps, args.reservation.groupId);
    yield* ensureFacilityIsAvailable(deps, args.reservation.facilityId);
    yield* ensureNoApprovedOverlap(
      deps,
      args.reservation,
      "選んだ時間帯には、すでに承認済みの予約が入っています。別の時間帯を選んでください。",
    );

    const audience = yield* deps.reservationMailRecipientsQuery
      .findForNewReservation({
        groupId: args.reservation.groupId,
        applicantUserId: args.actorUserId,
      })
      .mapErr(toRecipientsError);

    const mails = createReservationMailDrafts(
      ReservationMailEvent.Applied,
      { id, startAt: args.reservation.startAt, endAt: args.reservation.endAt, statusReason: null },
      audience,
    );

    const outcome = yield* deps.reservationRepository.create(reservation, mails);
    requestImmediateDelivery(deps.mailOutboxNotifier, outcome.enqueuedMailIds);

    return okAsync({ reservationId: id });
  });
