import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { QueryErrorCode } from "~/query/error";
import type { AvailabilityReservationRow } from "~/query/facility/facility-availability-calendar";
import type { HolidayQuery } from "~/query/holiday";
import type { ApplicantGroupQuery } from "~/query/reservation/applicant-groups";
import type { ReservationFormGroup } from "~/query/reservation/reservation-form";
import type { UserGroupList } from "~/query/user/user-group-list";
import { fakeFacilityAvailabilityCalendarQuery } from "~/testing/fakes/facility";
import { fakeHolidayQuery } from "~/testing/fakes/holiday";
import { fakeApplicantGroupQuery } from "~/testing/fakes/reservation";
import { fakeUserGroupListQuery } from "~/testing/fakes/user";
import { getAvailabilityCalendarUseCase } from "./get-availability-calendar";

const meetingRoomA = { id: "fac_meeting_a", name: "ミーティングルーム A", description: null };

/** 自分が所属している団体の予約 */
const ownReservation: AvailabilityReservationRow = {
  id: "res_own",
  groupId: "grp_robotics",
  groupName: "ロボティクス開発プロジェクト",
  startAt: new Date("2026-09-12T10:00:00+09:00"),
  endAt: new Date("2026-09-12T12:00:00+09:00"),
  status: ReservationStatus.Approved,
  headCount: 4,
  note: "週次定例",
  hasApprovedOverlap: false,
};

/** 所属していない団体の予約 */
const otherReservation: AvailabilityReservationRow = {
  id: "res_other",
  groupId: "grp_ai_hackers",
  groupName: "AI ハッカソンチーム",
  startAt: new Date("2026-09-12T13:00:00+09:00"),
  endAt: new Date("2026-09-12T15:00:00+09:00"),
  status: ReservationStatus.Provisional,
  headCount: 20,
  note: "ハッカソンのキックオフ",
  hasApprovedOverlap: false,
};

/** 有効な団体に所属している状態 */
const enabledMembership: UserGroupList = [
  {
    id: "grp_robotics",
    name: "ロボティクス開発プロジェクト",
    status: GroupStatus.Enabled,
    role: MembershipRole.Member,
    memberCount: 3,
  },
];

/** 承認待ちの団体にしか所属していない状態（COND-006 で申請できない） */
const pendingMembership: UserGroupList = [
  {
    id: "grp_ai_hackers",
    name: "AI ハッカソンチーム",
    status: GroupStatus.Pending,
    role: MembershipRole.Member,
    memberCount: 2,
  },
];

const createDeps = (
  groups: UserGroupList,
  overrides?: {
    readonly holidayQuery?: HolidayQuery;
    readonly applicantGroupQuery?: ApplicantGroupQuery;
  },
) => {
  const userGroupListQuery = fakeUserGroupListQuery({
    findByUserId: () => okAsync(groups),
  });

  const facilityAvailabilityCalendarQuery = fakeFacilityAvailabilityCalendarQuery({
    findByFacilityAndPeriod: () =>
      okAsync({
        facilities: [meetingRoomA],
        facility: meetingRoomA,
        reservations: [ownReservation, otherReservation],
      }),
  });

  const holidayQuery =
    overrides?.holidayQuery ??
    fakeHolidayQuery({
      findHolidaysBetween: () => okAsync([]),
    });

  const applicantGroupQuery =
    overrides?.applicantGroupQuery ??
    fakeApplicantGroupQuery({
      find: () => okAsync([]),
    });

  return {
    userGroupListQuery,
    facilityAvailabilityCalendarQuery,
    holidayQuery,
    applicantGroupQuery,
  };
};

const args = {
  actorUserId: "usr_student_01",
  isStaff: false,
  facilityId: null,
  from: new Date("2026-09-07T00:00:00+09:00"),
  to: new Date("2026-09-14T00:00:00+09:00"),
  now: new Date("2026-09-08T10:00:00+09:00"),
};

describe("getAvailabilityCalendarUseCase", () => {
  it("自団体の予約には使用人数と備考が入る", async () => {
    const result = await getAvailabilityCalendarUseCase(createDeps(enabledMembership), args);

    const own = result._unsafeUnwrap().reservations.find((r) => r.id === "res_own");

    expect(own?.isOwnGroup).toBe(true);
    expect(own?.detail).toEqual({ headCount: 4, note: "週次定例" });
  });

  it("他団体の予約からは使用人数と備考を落とす", async () => {
    const result = await getAvailabilityCalendarUseCase(createDeps(enabledMembership), args);

    const other = result._unsafeUnwrap().reservations.find((r) => r.id === "res_other");

    // COND-008: 他団体には団体名・施設・日時・ステータスまでしか見せない。
    // ここが崩れると、画面に出していなくても通信の中身から読めてしまう
    expect(other?.isOwnGroup).toBe(false);
    expect(other?.detail).toBeNull();
    expect(JSON.stringify(other)).not.toContain("ハッカソンのキックオフ");
  });

  it("予約に団体の ID を載せない", async () => {
    const result = await getAvailabilityCalendarUseCase(createDeps(enabledMembership), args);

    const reservations = result._unsafeUnwrap().reservations;

    // COND-008 が他団体に見せてよいのは団体名まで。画面も団体名しか出さないので、
    // 自団体のぶんも含めて ID は渡さない
    expect(JSON.stringify(reservations)).not.toContain("grp_ai_hackers");
    expect(JSON.stringify(reservations)).not.toContain("grp_robotics");
  });

  it("他団体の予約でも団体名・日時・ステータスは残す", async () => {
    const result = await getAvailabilityCalendarUseCase(createDeps(enabledMembership), args);

    const other = result._unsafeUnwrap().reservations.find((r) => r.id === "res_other");

    // ここまで隠すと「いつ埋まっているか」が分からず、画面の意味が無くなる
    expect(other?.groupName).toBe("AI ハッカソンチーム");
    expect(other?.status).toBe(ReservationStatus.Provisional);
    expect(other?.startAt).toEqual(new Date("2026-09-12T13:00:00+09:00"));
  });

  it("事務局はどの団体の予約でも全項目を見られる", async () => {
    // COND-009: 事務局は所属に関わらず全団体の予約を扱える
    const result = await getAvailabilityCalendarUseCase(createDeps([]), {
      ...args,
      actorUserId: "usr_staff_01",
      isStaff: true,
    });

    const reservations = result._unsafeUnwrap().reservations;

    expect(reservations.every((reservation) => reservation.detail !== null)).toBe(true);
    // 所属していないので、事務局でも「自団体の予約」にはならない
    expect(reservations.every((reservation) => !reservation.isOwnGroup)).toBe(true);
  });

  it("有効な団体に所属していれば申請できる", async () => {
    const result = await getAvailabilityCalendarUseCase(createDeps(enabledMembership), args);

    expect(result._unsafeUnwrap().canApplyReservation).toBe(true);
  });

  it("承認待ちの団体にしか所属していない人は申請できない", async () => {
    const result = await getAvailabilityCalendarUseCase(createDeps(pendingMembership), args);

    // COND-006: 申請できるのは有効な団体だけ
    expect(result._unsafeUnwrap().canApplyReservation).toBe(false);
  });

  it("どの団体にも所属していない事務局は申請できる", async () => {
    const result = await getAvailabilityCalendarUseCase(createDeps([]), { ...args, isStaff: true });

    expect(result._unsafeUnwrap().canApplyReservation).toBe(true);
  });

  it("非事務局は直接作成できず、予約の transitions は空になる", async () => {
    const result = await getAvailabilityCalendarUseCase(createDeps(enabledMembership), args);
    const calendar = result._unsafeUnwrap();

    expect(calendar.canCreateDirectly).toBe(false);
    expect(calendar.reservations.every((r) => r.transitions.length === 0)).toBe(true);
  });

  it("事務局は直接作成でき、予約の transitions に事務局操作が含まれる", async () => {
    const result = await getAvailabilityCalendarUseCase(createDeps([]), {
      ...args,
      actorUserId: "usr_staff_01",
      isStaff: true,
    });
    const calendar = result._unsafeUnwrap();

    expect(calendar.canCreateDirectly).toBe(true);
    const approved = calendar.reservations.find((r) => r.id === "res_own");
    const provisional = calendar.reservations.find((r) => r.id === "res_other");

    expect(approved?.transitions).toContain("staffCancel");
    expect(provisional?.transitions).toContain("approve");
    expect(provisional?.transitions).toContain("reject");
  });

  it("施設が見つからないときは NOT_FOUND がそのまま伝播する", async () => {
    const deps = {
      userGroupListQuery: fakeUserGroupListQuery({
        findByUserId: () => okAsync(enabledMembership),
      }),
      facilityAvailabilityCalendarQuery: fakeFacilityAvailabilityCalendarQuery({
        findByFacilityAndPeriod: () =>
          errAsync({
            code: QueryErrorCode.NotFound,
            message: "施設・設備 fac_unknown が有効な施設の中に見つからない。",
          }),
      }),
      holidayQuery: fakeHolidayQuery({ findHolidaysBetween: () => okAsync([]) }),
      applicantGroupQuery: fakeApplicantGroupQuery({ find: () => okAsync([]) }),
    };

    const result = await getAvailabilityCalendarUseCase(deps, {
      ...args,
      facilityId: "fac_unknown",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.NotFound);
  });

  it("期間内の祝日の日付一覧が holidayDateKeys に入る", async () => {
    const holidayQuery: HolidayQuery = {
      findHolidaysBetween: (from, to) => {
        expect(from).toBe("2026-09-07");
        expect(to).toBe("2026-09-13"); // to は 2026-09-14 0:00 の前日
        return okAsync(["2026-09-15"]);
      },
    };

    const result = await getAvailabilityCalendarUseCase(
      createDeps(enabledMembership, { holidayQuery }),
      args,
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().holidayDateKeys).toEqual(["2026-09-15"]);
  });

  it("祝日取得がエラーの場合はそのエラーを返す", async () => {
    const holidayQuery: HolidayQuery = {
      findHolidaysBetween: () =>
        errAsync({
          code: QueryErrorCode.DatabaseError,
          message: "祝日取得失敗",
        }),
    };

    const result = await getAvailabilityCalendarUseCase(
      createDeps(enabledMembership, { holidayQuery }),
      args,
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.DatabaseError);
  });

  describe("canEdit（変更できるか）", () => {
    it("自団体のメンバーの開始前の仮予約は true", async () => {
      const provisional: AvailabilityReservationRow = {
        ...ownReservation,
        status: ReservationStatus.Provisional,
      };
      const deps = createDeps(enabledMembership);
      deps.facilityAvailabilityCalendarQuery.findByFacilityAndPeriod = () =>
        okAsync({
          facilities: [meetingRoomA],
          facility: meetingRoomA,
          reservations: [provisional],
        });

      const result = await getAvailabilityCalendarUseCase(deps, args);
      const reservation = result._unsafeUnwrap().reservations[0];
      expect(reservation?.canEdit).toBe(true);
    });

    it("他団体の予約は false", async () => {
      const result = await getAvailabilityCalendarUseCase(createDeps(enabledMembership), args);
      const other = result._unsafeUnwrap().reservations.find((r) => r.id === "res_other");
      expect(other?.canEdit).toBe(false);
    });

    it("事務局は自団体でなくても true（直接変更）", async () => {
      const result = await getAvailabilityCalendarUseCase(createDeps([]), {
        ...args,
        actorUserId: "usr_staff_01",
        isStaff: true,
      });
      const reservations = result._unsafeUnwrap().reservations;
      expect(reservations.length).toBeGreaterThan(0);
      expect(reservations.every((r) => r.canEdit)).toBe(true);
    });

    it("開始日時を過ぎた予約は false", async () => {
      // 予約の開始日時（2026-09-12T10:00）より後の now を渡す
      const pastNow = new Date("2026-09-12T10:01:00+09:00");
      const result = await getAvailabilityCalendarUseCase(createDeps(enabledMembership), {
        ...args,
        now: pastNow,
      });
      const own = result._unsafeUnwrap().reservations.find((r) => r.id === "res_own");
      expect(own?.canEdit).toBe(false);
    });
  });

  describe("applicantGroups", () => {
    const dummyGroups: readonly ReservationFormGroup[] = [
      { id: "grp_robotics", name: "ロボティクス開発プロジェクト" },
    ];

    it("一般ユーザーは自分の ID で applicantGroupQuery を呼び、読んだ団体が applicantGroups に入る", async () => {
      let passedMemberUserId: string | null | undefined;
      const applicantGroupQuery = fakeApplicantGroupQuery({
        find: ({ memberUserId }) => {
          passedMemberUserId = memberUserId;
          return okAsync(dummyGroups);
        },
      });

      const result = await getAvailabilityCalendarUseCase(
        createDeps(enabledMembership, { applicantGroupQuery }),
        { ...args, actorUserId: "usr_student_01", isStaff: false },
      );

      expect(passedMemberUserId).toBe("usr_student_01");
      expect(result._unsafeUnwrap().applicantGroups).toEqual(dummyGroups);
    });

    it("事務局は memberUserId: null で applicantGroupQuery を呼び、読んだ団体が applicantGroups に入る", async () => {
      let passedMemberUserId: string | null | undefined;
      const applicantGroupQuery = fakeApplicantGroupQuery({
        find: ({ memberUserId }) => {
          passedMemberUserId = memberUserId;
          return okAsync(dummyGroups);
        },
      });

      const result = await getAvailabilityCalendarUseCase(createDeps([], { applicantGroupQuery }), {
        ...args,
        actorUserId: "usr_staff_01",
        isStaff: true,
      });

      expect(passedMemberUserId).toBeNull();
      expect(result._unsafeUnwrap().applicantGroups).toEqual(dummyGroups);
    });
  });
});
