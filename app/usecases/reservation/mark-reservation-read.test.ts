import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { MembershipRole, type StoredMembership } from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationStatus,
  type Reservation,
  type ReservationError,
} from "~/domain/reservation";
import {
  fakeMembershipRepository,
  fakeReservationReadRepository,
  fakeReservationRepository,
} from "~/testing/fakes";
import { markReservationReadUseCase } from "./mark-reservation-read";

const sampleReservation: Reservation = {
  id: "res_001",
  groupId: "grp_001",
  facilityId: "fac_001",
  startAt: new Date("2026-10-15T10:00:00+09:00"),
  endAt: new Date("2026-10-15T12:00:00+09:00"),
  headCount: 5,
  note: null,
  status: ReservationStatus.Approved,
  statusReason: null,
  unlockArrangement: null,
  createdBy: "usr_other",
  createdAt: new Date("2026-10-14T09:00:00+09:00"),
  requestedAt: new Date("2026-10-14T09:00:00+09:00"),
  updatedAt: new Date("2026-10-14T09:00:00+09:00"),
};

describe("markReservationReadUseCase", () => {
  const now = new Date("2026-10-14T15:00:00+09:00");

  const createMockMembershipRepository = (membership: StoredMembership | null = null) =>
    fakeMembershipRepository({
      findByGroupAndUser: vi.fn().mockReturnValue(okAsync(membership)),
    });

  it("自団体のメンバーが予約を既読にできる", async () => {
    const upsert = vi.fn().mockReturnValue(okAsync(undefined));
    const reservationReadRepository = fakeReservationReadRepository({
      upsert,
    });
    const reservationRepository = fakeReservationRepository({
      findById: vi.fn().mockReturnValue(okAsync(sampleReservation)),
    });
    const membershipRepository = createMockMembershipRepository({
      id: "mem_01",
      groupId: "grp_001",
      userId: "usr_member",
      role: MembershipRole.Member,
    });

    const result = await markReservationReadUseCase(
      { reservationReadRepository, reservationRepository, membershipRepository },
      {
        reservationId: "res_001",
        actorUserId: "usr_member",
        isStaff: false,
        now,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(upsert).toHaveBeenCalledWith("usr_member", "res_001", now);
  });

  it("事務局スタッフは自団体でなくても既読にできる", async () => {
    const upsert = vi.fn().mockReturnValue(okAsync(undefined));
    const reservationReadRepository = fakeReservationReadRepository({
      upsert,
    });
    const reservationRepository = fakeReservationRepository({
      findById: vi.fn().mockReturnValue(okAsync(sampleReservation)),
    });
    const membershipRepository = createMockMembershipRepository(null);

    const result = await markReservationReadUseCase(
      { reservationReadRepository, reservationRepository, membershipRepository },
      {
        reservationId: "res_001",
        actorUserId: "usr_staff",
        isStaff: true,
        now,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(upsert).toHaveBeenCalledWith("usr_staff", "res_001", now);
  });

  it("全項目を見られない他団体の一般ユーザーは既読にできず Forbidden を返す", async () => {
    const upsert = vi.fn().mockReturnValue(okAsync(undefined));
    const reservationReadRepository = fakeReservationReadRepository({
      upsert,
    });
    const reservationRepository = fakeReservationRepository({
      findById: vi.fn().mockReturnValue(okAsync(sampleReservation)),
    });
    const membershipRepository = createMockMembershipRepository(null);

    const result = await markReservationReadUseCase(
      { reservationReadRepository, reservationRepository, membershipRepository },
      {
        reservationId: "res_001",
        actorUserId: "usr_stranger",
        isStaff: false,
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(ReservationErrorCode.Forbidden);
    }
    expect(upsert).not.toHaveBeenCalled();
  });

  it("予約が存在しない場合は NotFound を返す", async () => {
    const reservationReadRepository = fakeReservationReadRepository();
    const reservationRepository = fakeReservationRepository({
      findById: vi.fn().mockReturnValue(
        errAsync<Reservation, ReservationError>({
          code: ReservationErrorCode.NotFound,
          message: "予約が見つかりません。",
        }),
      ),
    });
    const membershipRepository = createMockMembershipRepository(null);

    const result = await markReservationReadUseCase(
      { reservationReadRepository, reservationRepository, membershipRepository },
      {
        reservationId: "res_non_existing",
        actorUserId: "usr_member",
        isStaff: false,
        now,
      },
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(ReservationErrorCode.NotFound);
    }
  });
});
