import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { QueryErrorCode } from "~/query/error";
import type {
  ReservationListFacility,
  ReservationListQuery,
  ReservationListRow,
  ReservationStatusCounts,
} from "~/query/reservation/reservation-list";
import type { UserGroupList, UserGroupListQuery } from "~/query/user/user-group-list";
import { getReservationListUseCase, type GetReservationListArgs } from "./get-reservation-list";

const meetingRoomA: ReservationListFacility = {
  id: "fac_meeting_a",
  name: "ミーティングルーム A",
};

/** 自団体の予約行 */
const ownRow: ReservationListRow = {
  id: "res_own",
  groupId: "grp_robotics",
  groupName: "ロボティクス開発プロジェクト",
  facilityId: "fac_meeting_a",
  facilityName: "ミーティングルーム A",
  startAt: new Date("2026-09-24T10:00:00+09:00"),
  endAt: new Date("2026-09-24T12:00:00+09:00"),
  status: ReservationStatus.Approved,
  statusReason: null,
  headCount: 4,
  note: "定例会議",
  createdByName: "阪大 太郎",
  createdAt: new Date("2026-09-20T10:00:00+09:00"),
};

/** 他団体の予約行 */
const otherRow: ReservationListRow = {
  id: "res_other",
  groupId: "grp_ai_hackers",
  groupName: "AI ハッカソンチーム",
  facilityId: "fac_meeting_a",
  facilityName: "ミーティングルーム A",
  startAt: new Date("2026-09-24T13:00:00+09:00"),
  endAt: new Date("2026-09-24T15:00:00+09:00"),
  status: ReservationStatus.Provisional,
  statusReason: null,
  headCount: 10,
  note: "AI勉強会",
  createdByName: "他団体 メンバー",
  createdAt: new Date("2026-09-21T11:00:00+09:00"),
};

const defaultCounts: ReservationStatusCounts = {
  all: 2,
  provisional: 1,
  approved: 1,
  ended: 0,
};

/** テスト用ユーザーの所属団体 */
const userGroups: UserGroupList = [
  {
    id: "grp_robotics",
    name: "ロボティクス開発プロジェクト",
    status: GroupStatus.Enabled,
    role: MembershipRole.Member,
  },
  {
    id: "grp_second_group",
    name: "第2所属団体",
    status: GroupStatus.Enabled,
    role: MembershipRole.Admin,
  },
];

const now = new Date("2026-09-22T12:00:00+09:00");

const defaultArgs: GetReservationListArgs = {
  actorUserId: "usr_student_01",
  isStaff: false,
  scope: "own",
  groupId: "grp_robotics",
  status: "all",
  period: "upcoming",
  facilityId: null,
  now,
};

const createDeps = (
  groups: UserGroupList = userGroups,
  rows: readonly ReservationListRow[] = [ownRow],
  counts: ReservationStatusCounts = defaultCounts,
) => {
  const findByUserId = vi.fn((_userId: string) => okAsync(groups));
  const userGroupListQuery: UserGroupListQuery = { findByUserId };

  const findList = vi.fn((_args: unknown) => okAsync(rows));
  const countByStatus = vi.fn((_args: unknown) => okAsync(counts));
  const findFacilities = vi.fn(() => okAsync([meetingRoomA]));

  const reservationListQuery: ReservationListQuery = {
    findList,
    countByStatus,
    findFacilities,
  };

  return {
    deps: { reservationListQuery, userGroupListQuery },
    spies: { findByUserId, findList, countByStatus, findFacilities },
  };
};

describe("getReservationListUseCase", () => {
  it("scope=own では本人が所属している団体 ID だけで絞り込む（他団体の予約が混ざらない）", async () => {
    const { deps, spies } = createDeps();

    const result = await getReservationListUseCase(deps, {
      ...defaultArgs,
      groupId: "grp_robotics",
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();

    // 呼び出した Query の引数を検証
    expect(spies.findList).toHaveBeenCalledWith(
      expect.objectContaining({
        groupIds: ["grp_robotics"],
      }),
    );
    expect(value.selectedGroup?.id).toBe("grp_robotics");
    expect(value.items).toHaveLength(1);
    expect(value.items[0].id).toBe("res_own");
  });

  it("scope=own で他団体の ID を URL で指定されても、所属団体の先頭に安全にフォールバックする（COND-008）", async () => {
    const { deps, spies } = createDeps();

    // 他団体 "grp_ai_hackers"（所属していない）を直接指定
    const result = await getReservationListUseCase(deps, {
      ...defaultArgs,
      groupId: "grp_ai_hackers",
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();

    // 所属していない団体 ID ではなく、所属団体の先頭 "grp_robotics" が渡されること
    expect(spies.findList).toHaveBeenCalledWith(
      expect.objectContaining({
        groupIds: ["grp_robotics"],
      }),
    );
    expect(value.selectedGroup?.id).toBe("grp_robotics");
  });

  it("画面へ渡す ReservationListItem から groupId が型レベル・実値ともに除外されている", async () => {
    const { deps } = createDeps(userGroups, [ownRow]);

    const result = await getReservationListUseCase(deps, defaultArgs);
    const item = result._unsafeUnwrap().items[0];

    // @ts-expect-error groupId は ReservationListItem に存在しないこと
    expect(item.groupId).toBeUndefined();
    expect(Object.keys(item)).not.toContain("groupId");
    expect(item.groupName).toBe("ロボティクス開発プロジェクト");
  });

  it("事務局以外が scope=all を指定した場合は FORBIDDEN エラーを返す（COND-009）", async () => {
    const { deps } = createDeps();

    const result = await getReservationListUseCase(deps, {
      ...defaultArgs,
      isStaff: false,
      scope: "all",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("事務局が scope=all を指定した場合は groupIds=null で全団体の予約を取得する", async () => {
    const { deps, spies } = createDeps(userGroups, [ownRow, otherRow]);

    const result = await getReservationListUseCase(deps, {
      ...defaultArgs,
      actorUserId: "usr_staff_01",
      isStaff: true,
      scope: "all",
    });

    expect(result.isOk()).toBe(true);
    expect(spies.findList).toHaveBeenCalledWith(
      expect.objectContaining({
        groupIds: null,
      }),
    );
    expect(result._unsafeUnwrap().items).toHaveLength(2);
  });

  it("所属団体が 0 件の一般利用者の場合、エラーにならず空結果が返る", async () => {
    const { deps, spies } = createDeps([]);

    const result = await getReservationListUseCase(deps, defaultArgs);

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.items).toEqual([]);
    expect(value.selectedGroup).toBeNull();
    expect(value.counts).toEqual({ all: 0, provisional: 0, approved: 0, ended: 0 });
    // 予約一覧クエリは実行されないこと
    expect(spies.findList).not.toHaveBeenCalled();
  });

  it("事務局の仮予約（承認待ち）表示では申請日時の昇順（created_at_asc）でソートされる", async () => {
    const { deps, spies } = createDeps();

    await getReservationListUseCase(deps, {
      ...defaultArgs,
      actorUserId: "usr_staff_01",
      isStaff: true,
      scope: "all",
      status: "provisional",
      period: "upcoming",
    });

    expect(spies.findList).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: "created_at_asc",
      }),
    );
  });

  it("period=past の場合は開始日時の降順（start_at_desc）でソートされる", async () => {
    const { deps, spies } = createDeps();

    await getReservationListUseCase(deps, {
      ...defaultArgs,
      period: "past",
    });

    expect(spies.findList).toHaveBeenCalledWith(
      expect.objectContaining({
        sort: "start_at_desc",
        from: null,
        to: now,
      }),
    );
  });
});
