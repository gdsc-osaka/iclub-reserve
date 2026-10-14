import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import {
  MembershipRole,
  type MembershipRepository,
  type StoredMembership,
} from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationStatus,
  type Reservation,
  type ReservationError,
  type ReservationReadRepository,
  type ReservationRepository,
} from "~/domain/reservation";
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
  createdBy: "usr_other",
  createdAt: new Date("2026-10-14T09:00:00+09:00"),
  updatedAt: new Date("2026-10-14T09:00:00+09:00"),
};

describe("markReservationReadUseCase", () => {
  const now = new Date("2026-10-14T15:00:00+09:00");

  const createMockMembershipRepository = (
    membership: StoredMembership | null = null,
  ): MembershipRepository => ({
    findByGroupAndUser: vi.fn().mockReturnValue(okAsync(membership)),
    findByGroupAndEmail: vi.fn().mockReturnValue(okAsync(null)),
    countAdmins: vi.fn().mockReturnValue(okAsync(1)),
    updateRole: vi.fn().mockReturnValue(okAsync(1)),
    remove: vi.fn().mockReturnValue(okAsync(1)),
  });

  it("自団体のメンバーが予約を既読にできる", async () => {
    const upsert = vi.fn().mockReturnValue(okAsync(undefined));
    const reservationReadRepository: ReservationReadRepository = {
      upsert,
      upsertMany: vi.fn(),
      findByUserAndReservation: vi.fn(),
    };
    const reservationRepository: ReservationRepository = {
      findById: vi.fn().mockReturnValue(okAsync(sampleReservation)),
      create: vi.fn(),
      createApproved: vi.fn(),
      existsApprovedOverlap: vi.fn(),
      applyStatusTransition: vi.fn(),
      applyContentEdit: vi.fn(),
    };
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
    const reservationReadRepository: ReservationReadRepository = {
      upsert,
      upsertMany: vi.fn(),
      findByUserAndReservation: vi.fn(),
    };
    const reservationRepository: ReservationRepository = {
      findById: vi.fn().mockReturnValue(okAsync(sampleReservation)),
      create: vi.fn(),
      createApproved: vi.fn(),
      existsApprovedOverlap: vi.fn(),
      applyStatusTransition: vi.fn(),
      applyContentEdit: vi.fn(),
    };
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
    const reservationReadRepository: ReservationReadRepository = {
      upsert,
      upsertMany: vi.fn(),
      findByUserAndReservation: vi.fn(),
    };
    const reservationRepository: ReservationRepository = {
      findById: vi.fn().mockReturnValue(okAsync(sampleReservation)),
      create: vi.fn(),
      createApproved: vi.fn(),
      existsApprovedOverlap: vi.fn(),
      applyStatusTransition: vi.fn(),
      applyContentEdit: vi.fn(),
    };
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
    const reservationReadRepository: ReservationReadRepository = {
      upsert: vi.fn(),
      upsertMany: vi.fn(),
      findByUserAndReservation: vi.fn(),
    };
    const reservationRepository: ReservationRepository = {
      findById: vi.fn().mockReturnValue(
        errAsync<Reservation, ReservationError>({
          code: ReservationErrorCode.NotFound,
          message: "予約が見つかりません。",
        }),
      ),
      create: vi.fn(),
      createApproved: vi.fn(),
      existsApprovedOverlap: vi.fn(),
      applyStatusTransition: vi.fn(),
      applyContentEdit: vi.fn(),
    };
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
