import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import { AuditLogAction, type AuditLogDraft } from "~/domain/audit-log";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import {
  ReservationErrorCode,
  ReservationStatus,
  UnlockArrangement,
  type ApplyStatusTransitionArgs,
  type Reservation,
} from "~/domain/reservation";
import type { ReservationMessage } from "~/domain/reservation/message";
import {
  fakeMailOutboxNotifier,
  fakeMembershipRepository,
  fakeReservationMailRecipientsQuery,
  fakeReservationRepository,
} from "~/testing/fakes";
import {
  resolveProvisionalOverlapUseCase,
  type ResolveProvisionalOverlapArgs,
  type ResolveProvisionalOverlapDeps,
} from "./resolve-provisional-overlap";

const testNow = new Date("2026-10-15T12:00:00+09:00");

const createReservation = (
  id: string,
  start: string,
  end: string,
  status: ReservationStatus = ReservationStatus.Provisional,
  facilityId = "fac_1",
): Reservation => ({
  id,
  groupId: "grp_1",
  facilityId,
  startAt: new Date(start),
  endAt: new Date(end),
  headCount: 2,
  note: null,
  status,
  statusReason: null,
  unlockArrangement: null,
  createdBy: "usr_student",
  createdAt: new Date("2026-10-01T10:00:00+09:00"),
  requestedAt: new Date("2026-10-01T10:00:00+09:00"),
  updatedAt: new Date("2026-10-01T10:00:00+09:00"),
});

const createMockDeps = (options?: {
  reservations?: Reservation[];
  hasApprovedOverlap?: boolean;
}) => {
  const reservationMap = new Map<string, Reservation>(
    (options?.reservations ?? []).map((r) => [r.id, { ...r }]),
  );
  const hasApprovedOverlap = options?.hasApprovedOverlap ?? false;

  const findById = vi.fn((id: string) => {
    const res = reservationMap.get(id);
    return res
      ? okAsync(res)
      : errAsync({
          code: ReservationErrorCode.NotFound,
          message: `予約 ${id} が見つかりません。`,
        });
  });

  const existsApprovedOverlap = vi.fn((_args: unknown) => okAsync(hasApprovedOverlap));

  const applyStatusTransition = vi.fn(
    (
      args: ApplyStatusTransitionArgs,
      _mails: readonly MailDraft[],
      _auditLog?: AuditLogDraft,
      _calendarSync?: unknown,
      _message?: ReservationMessage | null,
    ) => {
      const current = reservationMap.get(args.id);
      if (!current || current.status !== args.expectedStatus) {
        return okAsync({ applied: false, enqueuedMailIds: [] });
      }
      current.status = args.status;
      current.statusReason = args.statusReason;
      current.updatedAt = args.updatedAt;
      return okAsync({ applied: true, enqueuedMailIds: [`mail_${args.id}`] });
    },
  );

  const reservationRepository = fakeReservationRepository({
    findById,
    existsApprovedOverlap,
    applyStatusTransition,
  });

  const membershipRepository = fakeMembershipRepository({
    findByGroupAndUser: vi.fn(() => okAsync(null)),
  });

  const reservationMailRecipientsQuery = fakeReservationMailRecipientsQuery({
    findByReservationId: vi.fn(() =>
      okAsync({
        groupMembers: [{ userId: "usr_student", address: "student@example.com", name: "代表" }],
        staff: [],
      }),
    ),
  });

  const notifyEnqueued = vi.fn((_outboxIds: readonly string[]) => undefined);
  const mailOutboxNotifier = fakeMailOutboxNotifier({ notifyEnqueued });

  const deps: ResolveProvisionalOverlapDeps = {
    reservationRepository,
    membershipRepository,
    reservationMailRecipientsQuery,
    mailOutboxNotifier,
  };

  return {
    deps,
    reservationMap,
    spies: {
      findById,
      existsApprovedOverlap,
      applyStatusTransition,
      notifyEnqueued,
    },
  };
};

const baseArgs: ResolveProvisionalOverlapArgs = {
  reservationId: "res_win",
  rejectReservationIds: ["res_rej_1", "res_rej_2"],
  actorUserId: "usr_staff_01",
  isStaff: true,
  reason: "別の予約と重なるため",
  unlockArrangement: UnlockArrangement.NotRequired,
  now: testNow,
  appBaseUrl: "https://reserve.example.com",
};

describe("resolveProvisionalOverlapUseCase", () => {
  it("事務局の画面でないと、予約を引く前に Forbidden になり findById が呼ばれない", async () => {
    const { deps, spies } = createMockDeps();

    const result = await resolveProvisionalOverlapUseCase(deps, {
      ...baseArgs,
      isStaff: false,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
    expect(spies.findById).not.toHaveBeenCalled();
    expect(spies.applyStatusTransition).not.toHaveBeenCalled();
  });

  it("却下するものがあって理由が空白だけなら InvalidInput で、承認も却下もしない", async () => {
    const resWin = createReservation(
      "res_win",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
    );
    const resRej = createReservation(
      "res_rej_1",
      "2026-10-15T11:00:00+09:00",
      "2026-10-15T13:00:00+09:00",
    );
    const { deps, spies } = createMockDeps({ reservations: [resWin, resRej] });

    const result = await resolveProvisionalOverlapUseCase(deps, {
      ...baseArgs,
      reason: "   ",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidInput);
    expect(spies.applyStatusTransition).not.toHaveBeenCalled();
  });

  it("承認できない（承認済みの予約と重なる）と、何も却下しない", async () => {
    const resWin = createReservation(
      "res_win",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
    );
    const resRej = createReservation(
      "res_rej_1",
      "2026-10-15T11:00:00+09:00",
      "2026-10-15T13:00:00+09:00",
    );
    const { deps, spies } = createMockDeps({
      reservations: [resWin, resRej],
      hasApprovedOverlap: true,
    });

    const result = await resolveProvisionalOverlapUseCase(deps, baseArgs);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Conflict);
    expect(spies.applyStatusTransition).not.toHaveBeenCalled();
  });

  it("承認して重なる仮予約を却下する（承認・却下の通知と操作履歴が積まれ、理由は正規化される）", async () => {
    const resWin = createReservation(
      "res_win",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
    );
    const resRej1 = createReservation(
      "res_rej_1",
      "2026-10-15T11:00:00+09:00",
      "2026-10-15T13:00:00+09:00",
    );
    const resRej2 = createReservation(
      "res_rej_2",
      "2026-10-15T10:30:00+09:00",
      "2026-10-15T11:30:00+09:00",
    );
    const { deps, spies, reservationMap } = createMockDeps({
      reservations: [resWin, resRej1, resRej2],
    });

    const result = await resolveProvisionalOverlapUseCase(deps, {
      ...baseArgs,
      reason: "  別の予約と重なるため  ",
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.approval.reservationId).toBe("res_win");
    expect(value.approval.status).toBe(ReservationStatus.Approved);
    expect(value.rejectedReservationIds).toEqual(["res_rej_1", "res_rej_2"]);
    expect(value.skipped).toHaveLength(0);

    // 承認と2件の却下で合計3回更新が走る
    expect(spies.applyStatusTransition).toHaveBeenCalledTimes(3);
    expect(reservationMap.get("res_win")?.status).toBe(ReservationStatus.Approved);
    expect(reservationMap.get("res_rej_1")?.status).toBe(ReservationStatus.Rejected);
    expect(reservationMap.get("res_rej_1")?.statusReason).toBe("別の予約と重なるため");
    expect(reservationMap.get("res_rej_2")?.status).toBe(ReservationStatus.Rejected);
    expect(reservationMap.get("res_rej_2")?.statusReason).toBe("別の予約と重なるため");

    // 操作履歴の検証
    const auditLogs = spies.applyStatusTransition.mock.calls.map((call) => call[2]);
    expect(auditLogs[0]?.action).toBe(AuditLogAction.ReservationApprove);
    expect(auditLogs[1]?.action).toBe(AuditLogAction.ReservationReject);
    expect(auditLogs[2]?.action).toBe(AuditLogAction.ReservationReject);

    // メール即時配送依頼が3回呼ばれる
    expect(spies.notifyEnqueued).toHaveBeenCalledTimes(3);
  });

  it("承認した予約と重ならなくなった仮予約は却下せずに skipped に入る（Conflict）", async () => {
    const resWin = createReservation(
      "res_win",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
    );
    // 時間帯がずれて重ならなくなった予約
    const resRejShifted = createReservation(
      "res_rej_1",
      "2026-10-15T12:00:00+09:00",
      "2026-10-15T14:00:00+09:00",
    );
    const { deps, spies } = createMockDeps({ reservations: [resWin, resRejShifted] });

    const result = await resolveProvisionalOverlapUseCase(deps, {
      ...baseArgs,
      rejectReservationIds: ["res_rej_1"],
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.approval.reservationId).toBe("res_win");
    expect(value.rejectedReservationIds).toEqual([]);
    expect(value.skipped).toHaveLength(1);
    expect(value.skipped[0]?.reservationId).toBe("res_rej_1");
    expect(value.skipped[0]?.error.code).toBe(ReservationErrorCode.Conflict);
    // 承認の1回だけ更新される
    expect(spies.applyStatusTransition).toHaveBeenCalledTimes(1);
  });

  it("仮予約でなくなった予約は InvalidTransition、存在しない予約は NotFound として skipped に入る", async () => {
    const resWin = createReservation(
      "res_win",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
    );
    const resWithdrawn = createReservation(
      "res_withdrawn",
      "2026-10-15T11:00:00+09:00",
      "2026-10-15T13:00:00+09:00",
      ReservationStatus.Withdrawn,
    );
    const { deps, spies } = createMockDeps({ reservations: [resWin, resWithdrawn] });

    const result = await resolveProvisionalOverlapUseCase(deps, {
      ...baseArgs,
      rejectReservationIds: ["res_withdrawn", "res_not_found"],
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.approval.reservationId).toBe("res_win");
    expect(value.rejectedReservationIds).toEqual([]);
    expect(value.skipped).toHaveLength(2);
    expect(value.skipped[0]?.reservationId).toBe("res_withdrawn");
    expect(value.skipped[0]?.error.code).toBe(ReservationErrorCode.InvalidTransition);
    expect(value.skipped[1]?.reservationId).toBe("res_not_found");
    expect(value.skipped[1]?.error.code).toBe(ReservationErrorCode.NotFound);
    expect(spies.applyStatusTransition).toHaveBeenCalledTimes(1);
  });

  it("重複した ID と承認する予約自身の ID は無視する（1 回だけ却下・自分は却下しない）", async () => {
    const resWin = createReservation(
      "res_win",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
    );
    const resRej1 = createReservation(
      "res_rej_1",
      "2026-10-15T11:00:00+09:00",
      "2026-10-15T13:00:00+09:00",
    );
    const { deps, spies } = createMockDeps({ reservations: [resWin, resRej1] });

    const result = await resolveProvisionalOverlapUseCase(deps, {
      ...baseArgs,
      rejectReservationIds: ["res_win", "res_rej_1", "res_rej_1"],
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.approval.reservationId).toBe("res_win");
    expect(value.rejectedReservationIds).toEqual(["res_rej_1"]);
    expect(value.skipped).toHaveLength(0);
    // 承認1回、却下1回の計2回
    expect(spies.applyStatusTransition).toHaveBeenCalledTimes(2);
  });

  it("却下するものが無ければふつうの承認と同じで理由は読まない", async () => {
    const resWin = createReservation(
      "res_win",
      "2026-10-15T10:00:00+09:00",
      "2026-10-15T12:00:00+09:00",
    );
    const { deps, spies } = createMockDeps({ reservations: [resWin] });

    const result = await resolveProvisionalOverlapUseCase(deps, {
      ...baseArgs,
      rejectReservationIds: [],
      reason: "   ", // 読まれないので InvalidInput にならない
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.approval.reservationId).toBe("res_win");
    expect(value.approval.status).toBe(ReservationStatus.Approved);
    expect(value.rejectedReservationIds).toEqual([]);
    expect(value.skipped).toEqual([]);
    expect(spies.applyStatusTransition).toHaveBeenCalledTimes(1);
  });
});
