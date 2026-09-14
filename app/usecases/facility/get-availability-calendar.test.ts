import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { QueryErrorCode } from "~/query/error";
import type {
  AvailabilityReservationRow,
  FacilityAvailabilityCalendarQuery,
} from "~/query/facility/facility-availability-calendar";
import type { UserGroupList, UserGroupListQuery } from "~/query/user/user-group-list";
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
};

/** 有効な団体に所属している状態 */
const enabledMembership: UserGroupList = [
  {
    id: "grp_robotics",
    name: "ロボティクス開発プロジェクト",
    status: GroupStatus.Enabled,
    roles: [MembershipRole.Member],
  },
];

/** 承認待ちの団体にしか所属していない状態（COND-006 で申請できない） */
const pendingMembership: UserGroupList = [
  {
    id: "grp_ai_hackers",
    name: "AI ハッカソンチーム",
    status: GroupStatus.Pending,
    roles: [MembershipRole.Member],
  },
];

const createDeps = (groups: UserGroupList) => {
  const userGroupListQuery: UserGroupListQuery = { findByUserId: () => okAsync(groups) };

  const facilityAvailabilityCalendarQuery: FacilityAvailabilityCalendarQuery = {
    findByFacilityAndPeriod: () =>
      okAsync({
        facilities: [meetingRoomA],
        facility: meetingRoomA,
        reservations: [ownReservation, otherReservation],
      }),
  };

  return { userGroupListQuery, facilityAvailabilityCalendarQuery };
};

const args = {
  actorUserId: "usr_student_01",
  isStaff: false,
  facilityId: null,
  from: new Date("2026-09-07T00:00:00+09:00"),
  to: new Date("2026-09-14T00:00:00+09:00"),
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

  it("施設が見つからないときは NOT_FOUND がそのまま伝播する", async () => {
    const deps = {
      userGroupListQuery: { findByUserId: () => okAsync(enabledMembership) } as UserGroupListQuery,
      facilityAvailabilityCalendarQuery: {
        findByFacilityAndPeriod: () =>
          errAsync({
            code: QueryErrorCode.NotFound,
            message: "ID が fac_unknown の施設・設備は見つかりませんでした。",
          }),
      } as FacilityAvailabilityCalendarQuery,
    };

    const result = await getAvailabilityCalendarUseCase(deps, {
      ...args,
      facilityId: "fac_unknown",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.NotFound);
  });
});
