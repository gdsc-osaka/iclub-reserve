import { createId } from "@paralleldrive/cuid2";
import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import { toCalendarSyncDraft } from "~/domain/calendar";
import type { FacilityRepository } from "~/domain/facility";
import type { GroupRepository } from "~/domain/group";
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
import { toReservationCreatedChanges } from "~/domain/reservation/audit-log";
import { validateReservationDraft } from "~/domain/reservation/validation";
import { APPROVED_OVERLAP_MESSAGE, ensureNoApprovedOverlap } from "./_shared/approved-overlap";
import { ensureFacilityIsAvailable } from "./_shared/facility-availability";
import { ensureGroupIsEnabled } from "./_shared/group-enabled";
import { ensureReservationPermission } from "./_shared/reservation-authorization";

export interface CreateDirectReservationDeps {
  readonly reservationRepository: ReservationRepository;
  readonly membershipRepository: MembershipRepository;
  /** 申請元の団体が有効かを確かめるために使う（COND-006） */
  readonly groupRepository: GroupRepository;
  /** 申請先の施設・設備が使えるかを確かめるために使う */
  readonly facilityRepository: FacilityRepository;
}

export interface CreateDirectReservationArgs {
  readonly actorUserId: string;
  /** 申請する人が事務局かどうか（COND-009） */
  readonly isStaff: boolean;
  /** 「過去の日時か」を判定する基準になる現在時刻 */
  readonly now: Date;
  readonly reservation: {
    readonly facilityId: string;
    readonly groupId: string;
    readonly startAt: Date;
    readonly endAt: Date;
    readonly headCount: number;
    readonly note: string | null;
  };
}

export interface CreateDirectReservationReturns {
  readonly reservationId: string;
}

/**
 * 承認済みの予約を直接作成するユースケース（UC-008）。
 *
 * ステータスは最初から「承認済み」（STATE-001）で作る（仮予約を経由しない）。
 * 引数に status を受け取らないのは、作成するステータスをユースケース側で
 * 承認済みに固定し、呼び出し元が任意の状態を指定できないようにするため。
 * 作成者（createdBy）は操作した事務局のユーザー、理由（statusReason）は null。
 *
 * 直接作成ではメールを送信しない（通知イベント EVT-009 は Google Calendar 登録のみで、
 * カレンダー連携は未着手のため。操作履歴への書き込み COND-013 も未実装のため行わない）。
 *
 * 【確かめる順序の理由】
 * DB を引かずに分かる入力の検証（validateReservationDraft）を先に、権限の確認をその次に置く。
 * 権限を団体の確認より先に置かないと、事務局でない人が団体 ID を当てずっぽうに送るだけで
 * 「その団体が有効かどうか」を読み取れてしまう。
 * 施設・団体の確認後に、重複の確認（COND-001）を作成の直前に置き、確認から作成までの間隔を短くする。
 * 承認済みの予約との重なりは、リポジトリ層の INSERT 文（createApproved）でも不可分に防ぐ。
 */
export const createDirectReservationUseCase = (
  deps: CreateDirectReservationDeps,
  args: CreateDirectReservationArgs,
): ResultAsync<CreateDirectReservationReturns, ReservationError> =>
  safeTry(async function* () {
    const id = createId();
    const now = args.now;
    const reservation: Reservation = {
      ...args.reservation,
      id,
      status: ReservationStatus.Approved,
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
      ReservationAction.CreateDirect,
      "予約を直接作成できるのは事務局だけです。",
    );
    yield* ensureGroupIsEnabled(
      deps,
      args.reservation.groupId,
      "予約を作成できるのは、事務局が有効にした団体だけです。",
    );
    yield* ensureFacilityIsAvailable(deps, args.reservation.facilityId);
    yield* ensureNoApprovedOverlap(deps, args.reservation, APPROVED_OVERLAP_MESSAGE);

    const auditLog: AuditLogDraft = {
      occurredAt: now,
      actorId: args.actorUserId,
      actedAsStaff: true, // 事務局だけの操作なので常に true（COND-012）
      action: AuditLogAction.ReservationDirectCreate,
      targetId: id,
      groupId: args.reservation.groupId,
      changes: toReservationCreatedChanges({
        facilityId: args.reservation.facilityId,
        startAt: args.reservation.startAt,
        endAt: args.reservation.endAt,
        headCount: args.reservation.headCount,
        note: args.reservation.note,
        status: ReservationStatus.Approved,
      }),
    };

    const calendarSyncDraft = toCalendarSyncDraft(id, null, {
      status: ReservationStatus.Approved,
      facilityId: reservation.facilityId,
      startAt: reservation.startAt,
      endAt: reservation.endAt,
    });

    const outcome = yield* deps.reservationRepository.createApproved(
      reservation,
      auditLog,
      calendarSyncDraft,
    );

    // 確認のあとに、同じ時間帯の別の予約が承認されていた
    if (!outcome.applied) {
      return errAsync<never, ReservationError>({
        code: ReservationErrorCode.Conflict,
        field: ReservationField.Period,
        message: `施設 ${reservation.facilityId} の同じ時間帯に、確認の後で承認済みの予約が入った。`,
        userMessage: APPROVED_OVERLAP_MESSAGE,
      });
    }

    return okAsync({ reservationId: id });
  });
