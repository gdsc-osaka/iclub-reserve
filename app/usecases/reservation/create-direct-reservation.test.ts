import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { AuditLogAction } from "~/domain/audit-log";
import { FacilityErrorCode, type Facility } from "~/domain/facility";
import { GroupErrorCode, GroupStatus, type Group } from "~/domain/group";
import { MembershipRole, type StoredMembership } from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationField,
  ReservationStatus,
  type Reservation,
} from "~/domain/reservation";
import {
  fakeFacilityRepository,
  fakeGroupRepository,
  fakeMembershipRepository,
  fakeReservationRepository,
} from "~/testing/fakes";
import { createDirectReservationUseCase } from "./create-direct-reservation";

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
  photoUrl: null,
  googleCalendarId: null,
  calendarUrl: null,
  isActive: true,
  createdAt: new Date("2026-04-01T00:00:00+09:00"),
  updatedAt: new Date("2026-04-01T00:00:00+09:00"),
};

const membership: StoredMembership = {
  id: "gm_membership",
  groupId: "grp_robotics",
  userId: "usr_staff_01",
  role: MembershipRole.Member,
};

/** 判定の基準になる「いま」。2026 年 9 月 14 日（月）の 9 時 */
const now = new Date("2026-09-14T09:00:00+09:00");

const args = {
  actorUserId: "usr_staff_01",
  isStaff: true,
  now,
  reservation: {
    facilityId: "fac_meeting_a",
    groupId: "grp_robotics",
    startAt: new Date("2026-09-16T10:00:00+09:00"),
    endAt: new Date("2026-09-16T12:00:00+09:00"),
    headCount: 4,
    note: "事務局主催説明会",
  },
};

const createDeps = (
  overrides: {
    membership?: StoredMembership | null;
    group?: Group;
    groupNotFound?: boolean;
    facility?: Facility;
    facilityNotFound?: boolean;
    hasApprovedOverlap?: boolean;
    /** 書き込みの条件（承認済みと重ならないこと）で止まったことにするか */
    blockedOnWrite?: boolean;
  } = {},
) => {
  const createApproved = vi.fn(
    (_reservation: Reservation, _auditDraft: unknown, _calendarSync?: unknown) =>
      okAsync({ applied: overrides.blockedOnWrite !== true }),
  );

  const reservationRepository = fakeReservationRepository({
    createApproved,
    existsApprovedOverlap: () => okAsync(overrides.hasApprovedOverlap ?? false),
  });

  const membershipRepository = fakeMembershipRepository({
    findByGroupAndUser: () =>
      okAsync(overrides.membership === undefined ? membership : overrides.membership),
  });

  const groupRepository = fakeGroupRepository({
    findById: () =>
      overrides.groupNotFound === true
        ? errAsync({ code: GroupErrorCode.NotFound, message: "not found" })
        : okAsync(overrides.group ?? enabledGroup),
  });

  const facilityRepository = fakeFacilityRepository({
    findById: () =>
      overrides.facilityNotFound === true
        ? errAsync({ code: FacilityErrorCode.NotFound, message: "not found" })
        : okAsync(overrides.facility ?? activeFacility),
  });

  return {
    deps: {
      reservationRepository,
      membershipRepository,
      groupRepository,
      facilityRepository,
    },
    createApproved,
  };
};

describe("createDirectReservationUseCase", () => {
  it("事務局が承認済みとして直接作成し、メールは送信しない（UC-008 / STATE-001）", async () => {
    const { deps, createApproved } = createDeps();

    const result = await createDirectReservationUseCase(deps, args);

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.reservationId).toBeDefined();

    expect(createApproved).toHaveBeenCalledTimes(1);
    const [created, auditDraft, calendarSyncDraft] = createApproved.mock.calls[0] ?? [];
    expect(created).toMatchObject({
      status: ReservationStatus.Approved,
      statusReason: null,
      createdBy: "usr_staff_01",
      facilityId: "fac_meeting_a",
      groupId: "grp_robotics",
      headCount: 4,
      note: "事務局主催説明会",
    });
    expect(auditDraft).toEqual({
      occurredAt: now,
      actorId: "usr_staff_01",
      actedAsStaff: true,
      action: AuditLogAction.ReservationDirectCreate,
      targetId: expect.any(String),
      groupId: "grp_robotics",
      changes: {
        facility_id: { before: null, after: "fac_meeting_a" },
        start_at: { before: null, after: args.reservation.startAt.toISOString() },
        end_at: { before: null, after: args.reservation.endAt.toISOString() },
        head_count: { before: null, after: 4 },
        note: { before: null, after: "事務局主催説明会" },
        status: { before: null, after: "approved" },
      },
    });
    expect(calendarSyncDraft).toEqual({
      reservationId: value.reservationId,
      previousFacilityId: null,
    });
  });

  it("非事務局は直接作成できず、Forbidden を返す", async () => {
    const { deps, createApproved } = createDeps();

    const result = await createDirectReservationUseCase(deps, {
      ...args,
      actorUserId: "usr_student_01",
      isStaff: false,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.Forbidden,
      userMessage: "予約を直接作成できるのは事務局だけです。",
    });
    expect(createApproved).not.toHaveBeenCalled();
  });

  it("承認待ちの団体としては直接作成できない", async () => {
    const { deps, createApproved } = createDeps({
      group: { ...enabledGroup, status: GroupStatus.Pending },
    });

    const result = await createDirectReservationUseCase(deps, args);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.GroupNotEligible,
      field: ReservationField.Group,
      userMessage: "予約を作成できるのは、事務局が有効にした団体だけです。",
    });
    expect(createApproved).not.toHaveBeenCalled();
  });

  it("無効化された団体としては直接作成できない", async () => {
    const { deps, createApproved } = createDeps({
      group: { ...enabledGroup, status: GroupStatus.Disabled },
    });

    const result = await createDirectReservationUseCase(deps, args);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.GroupNotEligible,
      field: ReservationField.Group,
      userMessage: "予約を作成できるのは、事務局が有効にした団体だけです。",
    });
    expect(createApproved).not.toHaveBeenCalled();
  });

  it("存在しない団体としては直接作成できない", async () => {
    const { deps, createApproved } = createDeps({ groupNotFound: true });

    const result = await createDirectReservationUseCase(deps, args);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.GroupNotEligible,
      field: ReservationField.Group,
    });
    expect(createApproved).not.toHaveBeenCalled();
  });

  it("無効な施設・設備では直接作成できない", async () => {
    const { deps, createApproved } = createDeps({
      facility: { ...activeFacility, isActive: false },
    });

    const result = await createDirectReservationUseCase(deps, args);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.FacilityNotAvailable,
      field: ReservationField.Facility,
    });
    expect(createApproved).not.toHaveBeenCalled();
  });

  it("存在しない施設・設備では直接作成できない", async () => {
    const { deps, createApproved } = createDeps({ facilityNotFound: true });

    const result = await createDirectReservationUseCase(deps, args);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.FacilityNotAvailable);
    expect(createApproved).not.toHaveBeenCalled();
  });

  it("承認済みの予約と重複する場合は Conflict で弾かれる（COND-001）", async () => {
    const { deps, createApproved } = createDeps({ hasApprovedOverlap: true });

    const result = await createDirectReservationUseCase(deps, args);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.Conflict,
      field: ReservationField.Period,
      userMessage:
        "選んだ時間帯には、すでに承認済みの予約が入っています。先にその予約をキャンセルするか、別の時間帯を選んでください。",
    });
    expect(createApproved).not.toHaveBeenCalled();
  });

  it("確認の後で同じ時間帯が承認され、書き込みの条件で止まったときも同じ Conflict を返す", async () => {
    // 確認から書き込みまでの間のすり抜けは、INSERT 文の条件で止まる（リポジトリのテストで確かめている）
    const { deps } = createDeps({ blockedOnWrite: true });

    const result = await createDirectReservationUseCase(deps, args);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.Conflict,
      field: ReservationField.Period,
      userMessage:
        "選んだ時間帯には、すでに承認済みの予約が入っています。先にその予約をキャンセルするか、別の時間帯を選んでください。",
    });
  });

  it.each([
    [
      "過去の日時",
      {
        startAt: new Date("2026-09-13T10:00:00+09:00"),
        endAt: new Date("2026-09-13T12:00:00+09:00"),
      },
      ReservationErrorCode.InvalidPeriod,
      ReservationField.Period,
    ],
    [
      "30分刻みでない",
      {
        startAt: new Date("2026-09-16T10:15:00+09:00"),
        endAt: new Date("2026-09-16T12:00:00+09:00"),
      },
      ReservationErrorCode.InvalidPeriod,
      ReservationField.Period,
    ],
    [
      "開館時間前",
      {
        startAt: new Date("2026-09-16T08:30:00+09:00"),
        endAt: new Date("2026-09-16T10:00:00+09:00"),
      },
      ReservationErrorCode.InvalidPeriod,
      ReservationField.Period,
    ],
    [
      "閉館時間後",
      {
        startAt: new Date("2026-09-16T19:00:00+09:00"),
        endAt: new Date("2026-09-16T21:30:00+09:00"),
      },
      ReservationErrorCode.InvalidPeriod,
      ReservationField.Period,
    ],
    ["人数が0", { headCount: 0 }, ReservationErrorCode.InvalidInput, ReservationField.HeadCount],
    [
      "備考が長すぎる（500文字超過）",
      { note: "あ".repeat(501) },
      ReservationErrorCode.InvalidInput,
      ReservationField.Note,
    ],
  ] as const)(
    "COND-021 違反（%s）はバリデーションエラーになる",
    async (_label, patch, code, field) => {
      const { deps, createApproved } = createDeps();

      const result = await createDirectReservationUseCase(deps, {
        ...args,
        reservation: {
          ...args.reservation,
          ...patch,
        },
      });

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toMatchObject({ code, field });
      expect(createApproved).not.toHaveBeenCalled();
    },
  );
});
