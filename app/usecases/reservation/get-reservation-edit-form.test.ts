import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { GroupErrorCode, GroupStatus, type Group, type GroupRepository } from "~/domain/group";
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
import type {
  ReservationFormArgs,
  ReservationFormFacility,
  ReservationFormQuery,
  ReservationFormReservationRow,
} from "~/query/reservation/reservation-form";
import type { UserGroupList, UserGroupListQuery } from "~/query/user/user-group-list";
import { getReservationEditFormUseCase } from "./get-reservation-edit-form";

const meetingRoomA: ReservationFormFacility = {
  id: "fac_meeting_a",
  name: "ミーティングルーム A",
  description: null,
  photoUrl: null,
};

const meetingRoomB: ReservationFormFacility = {
  id: "fac_meeting_b",
  name: "ミーティングルーム B",
  description: null,
  photoUrl: null,
};

const defaultReservation: Reservation = {
  id: "rsv_edit_target",
  groupId: "grp_robotics",
  facilityId: "fac_meeting_a",
  startAt: new Date("2026-09-16T10:00:00+09:00"),
  endAt: new Date("2026-09-16T12:00:00+09:00"),
  headCount: 4,
  note: "定期ミーティング",
  status: ReservationStatus.Provisional,
  statusReason: null,
  createdBy: "usr_student_01",
  createdAt: new Date("2026-09-14T09:00:00+09:00"),
  updatedAt: new Date("2026-09-14T09:00:00+09:00"),
};

const targetRow: ReservationFormReservationRow = {
  id: "rsv_edit_target",
  facilityId: "fac_meeting_a",
  groupId: "grp_robotics",
  groupName: "ロボティクス開発プロジェクト",
  startAt: new Date("2026-09-16T10:00:00+09:00"),
  endAt: new Date("2026-09-16T12:00:00+09:00"),
  status: ReservationStatus.Provisional,
};

const otherRow: ReservationFormReservationRow = {
  id: "rsv_other",
  facilityId: "fac_meeting_a",
  groupId: "grp_ai_hackers",
  groupName: "AI ハッカソンチーム",
  startAt: new Date("2026-09-16T13:00:00+09:00"),
  endAt: new Date("2026-09-16T15:00:00+09:00"),
  status: ReservationStatus.Approved,
};

const groupInfo: Group = {
  id: "grp_robotics",
  name: "ロボティクス開発プロジェクト",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-09-01T00:00:00+09:00"),
  updatedAt: new Date("2026-09-01T00:00:00+09:00"),
};

const memberMembership: Membership = {
  groupId: "grp_robotics",
  userId: "usr_student_01",
  role: MembershipRole.Member,
};

const myGroups: UserGroupList = [
  {
    id: "grp_robotics",
    name: "ロボティクス開発プロジェクト",
    status: GroupStatus.Enabled,
    role: MembershipRole.Member,
    memberCount: 4,
  },
];

/** 予約開始前（2026-09-16 09:00） */
const nowBefore = new Date("2026-09-16T09:00:00+09:00");
/** 予約開始後（2026-09-16 10:30） */
const nowAfter = new Date("2026-09-16T10:30:00+09:00");

const createDeps = (
  overrides: {
    reservation?: Reservation | null;
    membership?: Membership | null;
    group?: Group | null;
    reservations?: readonly ReservationFormReservationRow[];
    groups?: UserGroupList;
  } = {},
) => {
  const reservationRepository: ReservationRepository = {
    findById: () =>
      overrides.reservation === null
        ? errAsync({ code: ReservationErrorCode.NotFound, message: "not found" })
        : okAsync(overrides.reservation ?? defaultReservation),
    create: () => errAsync({ code: ReservationErrorCode.DatabaseError, message: "unused" }),
    createApproved: () => errAsync({ code: ReservationErrorCode.DatabaseError, message: "unused" }),
    existsApprovedOverlap: () => okAsync(false),
    applyStatusTransition: () =>
      errAsync({ code: ReservationErrorCode.DatabaseError, message: "unused" }),
    applyContentEdit: () =>
      errAsync({ code: ReservationErrorCode.DatabaseError, message: "unused" }),
  };

  const membershipRepository: MembershipRepository = {
    findByGroupAndUser: () =>
      okAsync(overrides.membership === undefined ? memberMembership : overrides.membership),
    countAdmins: () => errAsync({ code: MembershipErrorCode.DatabaseError, message: "unused" }),
    updateRole: () => errAsync({ code: MembershipErrorCode.DatabaseError, message: "unused" }),
    remove: () => errAsync({ code: MembershipErrorCode.DatabaseError, message: "unused" }),
  };

  const groupRepository: GroupRepository = {
    findById: () =>
      overrides.group === null
        ? errAsync({ code: GroupErrorCode.NotFound, message: "not found" })
        : okAsync(overrides.group ?? groupInfo),
    updateName: () => errAsync({ code: GroupErrorCode.DatabaseError, message: "unused" }),
    updateStatus: () => errAsync({ code: GroupErrorCode.DatabaseError, message: "unused" }),
    create: () => errAsync({ code: GroupErrorCode.DatabaseError, message: "unused" }),
  };

  const reservationFormQuery: ReservationFormQuery = {
    find: (_args: ReservationFormArgs) =>
      okAsync({
        groups: [{ id: "grp_robotics", name: "ロボティクス開発プロジェクト" }],
        facilities: [meetingRoomA, meetingRoomB],
        reservations: overrides.reservations ?? [targetRow, otherRow],
      }),
  };

  const userGroupListQuery: UserGroupListQuery = {
    findByUserId: () => okAsync(overrides.groups ?? myGroups),
  };

  return {
    reservationRepository,
    membershipRepository,
    groupRepository,
    reservationFormQuery,
    userGroupListQuery,
  };
};

describe("getReservationEditFormUseCase", () => {
  it("(a) 自団体のメンバーは開ける。変更中の予約が日の予約から除かれ、他団体の予約はマスクされる", async () => {
    const deps = createDeps();

    const result = await getReservationEditFormUseCase(deps, {
      reservationId: "rsv_edit_target",
      actorUserId: "usr_student_01",
      isStaff: false,
      dateKey: "2026-09-16",
      now: nowBefore,
    });

    expect(result.isOk()).toBe(true);
    const data = result._unsafeUnwrap();

    // 予約の基本情報
    expect(data.reservation).toEqual({
      id: "rsv_edit_target",
      groupName: "ロボティクス開発プロジェクト",
      facilityId: "fac_meeting_a",
      startAt: defaultReservation.startAt,
      endAt: defaultReservation.endAt,
      headCount: 4,
      note: "定期ミーティング",
      status: ReservationStatus.Provisional,
    });

    // 施設の選択肢
    expect(data.facilities).toHaveLength(2);

    // 表示する日の予約一覧: 変更中の予約そのものは除外されている
    const reservationIds = data.reservations.map((r) => r.id);
    expect(reservationIds).not.toContain("rsv_edit_target");
    expect(reservationIds).toContain("rsv_other");

    // 他団体の予約は isOwnGroup: false にマスクされている
    const other = data.reservations.find((r) => r.id === "rsv_other");
    expect(other?.isOwnGroup).toBe(false);
  });

  it("(b) 予約が無い → NotFound", async () => {
    const deps = createDeps({ reservation: null });

    const result = await getReservationEditFormUseCase(deps, {
      reservationId: "rsv_missing",
      actorUserId: "usr_student_01",
      isStaff: false,
      dateKey: "2026-09-16",
      now: nowBefore,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.NotFound);
  });

  it("(c) 他団体の人 → Forbidden", async () => {
    const deps = createDeps({ membership: null, groups: [] });

    const result = await getReservationEditFormUseCase(deps, {
      reservationId: "rsv_edit_target",
      actorUserId: "usr_other_01",
      isStaff: false,
      dateKey: "2026-09-16",
      now: nowBefore,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
  });

  it("(d) 終了した予約 → 弾かれる (InvalidTransition)", async () => {
    for (const status of [
      ReservationStatus.Withdrawn,
      ReservationStatus.Rejected,
      ReservationStatus.Cancelled,
      ReservationStatus.CancelledByStaff,
    ]) {
      const deps = createDeps({
        reservation: { ...defaultReservation, status },
      });

      const result = await getReservationEditFormUseCase(deps, {
        reservationId: "rsv_edit_target",
        actorUserId: "usr_student_01",
        isStaff: false,
        dateKey: "2026-09-16",
        now: nowBefore,
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidTransition);
    }
  });

  it("(e) 開始日時を過ぎた予約 → 弾かれる (InvalidTransition)", async () => {
    const deps = createDeps();

    const result = await getReservationEditFormUseCase(deps, {
      reservationId: "rsv_edit_target",
      actorUserId: "usr_student_01",
      isStaff: false,
      dateKey: "2026-09-16",
      now: nowAfter,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidTransition);
  });

  it("(f) 所属していない事務局 → Forbidden、所属している事務局 → 開ける", async () => {
    // 所属していない事務局
    const nonMemberDeps = createDeps({ membership: null });
    const nonMemberResult = await getReservationEditFormUseCase(nonMemberDeps, {
      reservationId: "rsv_edit_target",
      actorUserId: "usr_staff_01",
      isStaff: true,
      dateKey: "2026-09-16",
      now: nowBefore,
    });
    expect(nonMemberResult.isErr()).toBe(true);
    expect(nonMemberResult._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);

    // 所属している事務局
    const memberDeps = createDeps({
      membership: {
        groupId: "grp_robotics",
        userId: "usr_staff_01",
        role: MembershipRole.Member,
      },
    });
    const memberResult = await getReservationEditFormUseCase(memberDeps, {
      reservationId: "rsv_edit_target",
      actorUserId: "usr_staff_01",
      isStaff: true,
      dateKey: "2026-09-16",
      now: nowBefore,
    });
    expect(memberResult.isOk()).toBe(true);
  });
});
