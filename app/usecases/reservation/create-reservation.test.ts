import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { FacilityErrorCode, type Facility, type FacilityRepository } from "~/domain/facility";
import { GroupErrorCode, GroupStatus, type Group, type GroupRepository } from "~/domain/group";
import { MembershipRole, type Membership, type MembershipRepository } from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationStatus,
  type Reservation,
  type ReservationRepository,
} from "~/domain/reservation";
import { createProvisionalReservationUseCase } from "./create-reservation";

const enabledGroup: Group = {
  id: "grp_robotics",
  name: "ロボティクス開発プロジェクト",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-04-01T00:00:00+09:00"),
  updatedAt: new Date("2026-04-01T00:00:00+09:00"),
};

const activeFacility: Facility = {
  id: "fac_meeting_a",
  name: "会議室 A",
  description: null,
  isActive: true,
  createdAt: new Date("2026-04-01T00:00:00+09:00"),
  updatedAt: new Date("2026-04-01T00:00:00+09:00"),
};

const membership: Membership = {
  groupId: "grp_robotics",
  userId: "usr_student_01",
  roles: [MembershipRole.Member],
};

/** 判定の基準になる「いま」。2026 年 9 月 14 日（月）の 9 時 */
const now = new Date("2026-09-14T09:00:00+09:00");

const args = {
  actorUserId: "usr_student_01",
  isStaff: false,
  now,
  reservation: {
    facilityId: "fac_meeting_a",
    groupId: "grp_robotics",
    startAt: new Date("2026-09-16T10:00:00+09:00"),
    endAt: new Date("2026-09-16T12:00:00+09:00"),
    headCount: 4,
    note: "週次定例",
  },
};

const createDeps = (
  overrides: {
    membership?: Membership | null;
    group?: Group;
    groupNotFound?: boolean;
    facility?: Facility;
    facilityNotFound?: boolean;
    hasApprovedOverlap?: boolean;
  } = {},
) => {
  const create = vi.fn((_reservation: Reservation) => okAsync(null));

  const reservationRepository: ReservationRepository = {
    findById: () =>
      errAsync({ code: ReservationErrorCode.ReservationNotFound, message: "not found" }),
    create,
    existsApprovedOverlap: () => okAsync(overrides.hasApprovedOverlap ?? false),
    applyStatusTransition: () => okAsync(true),
  };

  const membershipRepository: MembershipRepository = {
    findByGroupAndUser: () =>
      okAsync(overrides.membership === undefined ? membership : overrides.membership),
  };

  const groupRepository: GroupRepository = {
    findById: () =>
      overrides.groupNotFound === true
        ? errAsync({ code: GroupErrorCode.GroupNotFound, message: "not found" })
        : okAsync(overrides.group ?? enabledGroup),
  };

  const facilityRepository: FacilityRepository = {
    findById: () =>
      overrides.facilityNotFound === true
        ? errAsync({ code: FacilityErrorCode.FacilityNotFound, message: "not found" })
        : okAsync(overrides.facility ?? activeFacility),
  };

  return {
    deps: { reservationRepository, membershipRepository, groupRepository, facilityRepository },
    create,
  };
};

describe("createProvisionalReservationUseCase", () => {
  it("必ず仮予約として作る（申請者は状態を選べない）", async () => {
    const { deps, create } = createDeps();

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result.isOk()).toBe(true);
    // STATE-001: 申請から生まれる予約は必ず仮予約
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      status: ReservationStatus.Provisional,
      statusReason: null,
      createdBy: "usr_student_01",
      facilityId: "fac_meeting_a",
      headCount: 4,
    });
  });

  it("所属していない団体では申請できない", async () => {
    const { deps, create } = createDeps({ membership: null });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationForbidden);
    expect(create).not.toHaveBeenCalled();
  });

  it("事務局は所属していない団体でも申請できる", async () => {
    // COND-009: 事務局の権限は団体内の役割とは別の軸で、所属していなくても成立する
    const { deps, create } = createDeps({ membership: null });

    const result = await createProvisionalReservationUseCase(deps, {
      ...args,
      actorUserId: "usr_staff_01",
      isStaff: true,
    });

    expect(result.isOk()).toBe(true);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ createdBy: "usr_staff_01" });
  });

  it("承認待ちの団体からは申請できない", async () => {
    // COND-006: 申請できるのは事務局が有効にした団体だけ
    const { deps, create } = createDeps({
      group: { ...enabledGroup, status: GroupStatus.Pending },
    });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationGroupNotEligible);
    expect(create).not.toHaveBeenCalled();
  });

  it("事務局でも、無効な団体としては申請できない", async () => {
    const { deps } = createDeps({ group: { ...enabledGroup, status: GroupStatus.Disabled } });

    const result = await createProvisionalReservationUseCase(deps, { ...args, isStaff: true });

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationGroupNotEligible);
  });

  it("存在しない団体では申請できない", async () => {
    const { deps } = createDeps({ groupNotFound: true });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationGroupNotEligible);
  });

  it("無効になっている施設・設備では申請できない", async () => {
    /*
     * 画面の選択肢は有効な施設だけだが、`facility_id` は POST を組み立てれば自由に送れる。
     * ここで止めないと、どの画面にも出ない予約（空き状況・申請フォームのどちらも
     * `is_active` で絞っている）が作られてしまう。
     */
    const { deps, create } = createDeps({ facility: { ...activeFacility, isActive: false } });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(
      ReservationErrorCode.ReservationFacilityNotAvailable,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("事務局でも、無効になっている施設・設備では申請できない", async () => {
    const { deps } = createDeps({ facility: { ...activeFacility, isActive: false } });

    const result = await createProvisionalReservationUseCase(deps, { ...args, isStaff: true });

    expect(result._unsafeUnwrapErr().code).toBe(
      ReservationErrorCode.ReservationFacilityNotAvailable,
    );
  });

  it("存在しない施設・設備では申請できない", async () => {
    const { deps, create } = createDeps({ facilityNotFound: true });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(
      ReservationErrorCode.ReservationFacilityNotAvailable,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("承認済みの予約と重なる時間帯では申請できない", async () => {
    // COND-001: 同一施設・同一時間帯に承認済みの予約があってはならない
    const { deps, create } = createDeps({ hasApprovedOverlap: true });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationConflict);
    expect(create).not.toHaveBeenCalled();
  });

  it("過ぎた日時では申請できない", async () => {
    const { deps, create } = createDeps();

    const result = await createProvisionalReservationUseCase(deps, {
      ...args,
      reservation: {
        ...args.reservation,
        startAt: new Date("2026-09-13T10:00:00+09:00"),
        endAt: new Date("2026-09-13T12:00:00+09:00"),
      },
    });

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidPeriod);
    expect(create).not.toHaveBeenCalled();
  });

  it("所属していない人には、団体が有効かどうかを知らせない", async () => {
    /*
     * 権限の確認を団体の確認より先に置いているかを確かめる。
     * 順番が逆だと、団体 ID を当てずっぽうに送るだけで
     * その団体が有効かどうかを読み取れてしまう。
     */
    const { deps } = createDeps({
      membership: null,
      group: { ...enabledGroup, status: GroupStatus.Disabled },
    });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationForbidden);
  });
});
