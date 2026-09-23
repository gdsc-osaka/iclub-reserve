import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import {
  MembershipErrorCode,
  MembershipRole,
  type Membership,
  type MembershipRepository,
} from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationStatus,
  type Reservation,
  type ReservationRepository,
} from "~/domain/reservation";
import { getReservationUseCase } from "./get-reservation";

const reservation: Reservation = {
  id: "rsv_01",
  facilityId: "fac_meeting_a",
  groupId: "grp_robotics",
  startAt: new Date("2026-09-16T10:00:00+09:00"),
  endAt: new Date("2026-09-16T12:00:00+09:00"),
  headCount: 4,
  note: "週次定例",
  status: ReservationStatus.Rejected,
  statusReason: "同じ時間帯に別の予約が入っているため",
  createdBy: "usr_student_01",
  createdAt: new Date("2026-09-14T09:00:00+09:00"),
  updatedAt: new Date("2026-09-15T09:00:00+09:00"),
};

const membership: Membership = {
  groupId: "grp_robotics",
  userId: "usr_student_01",
  role: MembershipRole.Member,
};

const createDeps = (
  overrides: {
    membership?: Membership | null;
    membershipDbError?: boolean;
    reservationNotFound?: boolean;
  } = {},
) => {
  const findById = vi.fn((_id: string) =>
    overrides.reservationNotFound === true
      ? errAsync({ code: ReservationErrorCode.NotFound, message: "not found" })
      : okAsync(reservation),
  );

  const findByGroupAndUser = vi.fn((_groupId: string, _userId: string) =>
    overrides.membershipDbError === true
      ? errAsync({ code: MembershipErrorCode.DatabaseError, message: "db down" })
      : okAsync(overrides.membership === undefined ? membership : overrides.membership),
  );

  const reservationRepository: ReservationRepository = {
    findById,
    // このテストでは呼ばれない前提。呼ばれたら失敗して気付けるようにしてある
    create: () =>
      errAsync({ code: ReservationErrorCode.DatabaseError, message: "このテストでは使わない" }),
    existsApprovedOverlap: () =>
      errAsync({ code: ReservationErrorCode.DatabaseError, message: "このテストでは使わない" }),
    applyStatusTransition: () =>
      errAsync({ code: ReservationErrorCode.DatabaseError, message: "このテストでは使わない" }),
  };

  const membershipRepository: MembershipRepository = {
    findByGroupAndUser,
    countAdmins: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    updateRole: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    remove: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
  };

  return {
    deps: { reservationRepository, membershipRepository },
    spies: { findById, findByGroupAndUser },
  };
};

describe("getReservationUseCase", () => {
  describe("可視範囲（COND-008）", () => {
    it("自団体のメンバーには全項目を返す", async () => {
      const { deps } = createDeps();

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({ canViewDetail: true, reservation });
    });

    it("事務局には、所属していない団体の予約でも全項目を返す（COND-009）", async () => {
      const { deps } = createDeps({ membership: null });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
      });

      expect(result._unsafeUnwrap()).toEqual({ canViewDetail: true, reservation });
    });

    it("他団体のユーザーには概要だけを返す", async () => {
      const { deps } = createDeps({ membership: null });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_other_01",
        isStaff: false,
      });

      expect(result._unsafeUnwrap()).toEqual({
        canViewDetail: false,
        reservation: {
          id: "rsv_01",
          facilityId: "fac_meeting_a",
          groupId: "grp_robotics",
          startAt: reservation.startAt,
          endAt: reservation.endAt,
          status: ReservationStatus.Rejected,
        },
      });
    });

    /*
     * 型を絞るだけでは、通信の中身を見れば読めてしまう。
     * 実データごと落ちていることを、キーの集合で確かめる。
     */
    it("他団体のユーザーに渡す予約には、使用人数・備考・理由・作成者のキー自体が無い", async () => {
      const { deps } = createDeps({ membership: null });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_other_01",
        isStaff: false,
      });

      const view = result._unsafeUnwrap();
      const keys = Object.keys(view.reservation);

      expect(keys).not.toContain("headCount");
      expect(keys).not.toContain("note");
      expect(keys).not.toContain("statusReason");
      expect(keys).not.toContain("createdBy");
    });
  });

  describe("所属の引き方", () => {
    it("事務局のときは所属を引かない（詳細の閲覧は事務局の役割だけで通るため）", async () => {
      const { deps, spies } = createDeps({ membership: null });

      await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
      });

      expect(spies.findByGroupAndUser).not.toHaveBeenCalled();
    });

    it("予約が属する団体での所属を引く（引数の団体ではない）", async () => {
      const { deps, spies } = createDeps();

      await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(spies.findByGroupAndUser).toHaveBeenCalledWith("grp_robotics", "usr_student_01");
    });

    it("所属の確認に失敗したら DatabaseError を返す（見つからない、に潰さない）", async () => {
      const { deps } = createDeps({ membershipDbError: true });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
    });
  });

  describe("予約 ID の扱い", () => {
    it("空白だけの ID は DB へ問い合わせずに打ち切る", async () => {
      const { deps, spies } = createDeps();

      const result = await getReservationUseCase(deps, {
        reservationId: "   ",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.NotFound);
      expect(spies.findById).not.toHaveBeenCalled();
    });

    it("前後の空白を落としてから引く", async () => {
      const { deps, spies } = createDeps();

      await getReservationUseCase(deps, {
        reservationId: "  rsv_01  ",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(spies.findById).toHaveBeenCalledWith("rsv_01");
    });

    it("存在しない予約は ReservationNotFound を返す", async () => {
      const { deps } = createDeps({ reservationNotFound: true });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_missing",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.NotFound);
    });
  });
});
