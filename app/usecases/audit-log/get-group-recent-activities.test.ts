import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { RECENT_ACTIVITIES_LIMIT } from "~/domain/audit-log";
import type {
  GroupRecentActivitiesQuery,
  GroupRecentActivityItem,
} from "~/query/audit-log/group-recent-activities";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { UserGroupList, UserGroupListQuery } from "~/query/user/user-group-list";
import { getGroupRecentActivitiesUseCase } from "./get-group-recent-activities";

describe("getGroupRecentActivitiesUseCase", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");

  const adminGroup: UserGroupList[number] = {
    id: "grp_1",
    name: "団体A",
    status: GroupStatus.Enabled,
    role: MembershipRole.Admin,
    memberCount: 2,
  };
  const memberGroup: UserGroupList[number] = {
    id: "grp_2",
    name: "団体B",
    status: GroupStatus.Enabled,
    role: MembershipRole.Member,
    memberCount: 4,
  };

  /** 他のメンバーが予約を申請した記録 */
  const applyActivity: GroupRecentActivityItem = {
    id: "log_1",
    occurredAt: new Date("2026-10-14T10:00:00.000Z"),
    actorName: "メンバー2",
    actedAsStaff: false,
    action: "reservation.apply",
    targetType: "reservation",
    targetId: "res_1",
    groupId: "grp_1",
    groupName: "団体A",
    reservation: {
      facilityName: "工作室",
      startAt: new Date("2026-10-20T10:00:00.000Z"),
      endAt: new Date("2026-10-20T12:00:00.000Z"),
    },
    changes: {},
  };

  /** 事務局が横断権限で団体を有効化した記録 */
  const staffEnableActivity: GroupRecentActivityItem = {
    id: "log_2",
    occurredAt: new Date("2026-10-14T11:00:00.000Z"),
    actorName: "事務局員",
    actedAsStaff: true,
    action: "group.enable",
    targetType: "group",
    targetId: "grp_1",
    groupId: "grp_1",
    groupName: "団体A",
    reservation: null,
    changes: {},
  };

  const createMockGroupListQuery = (groups: UserGroupList): UserGroupListQuery => ({
    findByUserId: () => okAsync(groups),
  });

  const createMockRecentActivitiesQuery = (
    activities: readonly GroupRecentActivityItem[],
    capturedArgs?: { current: unknown },
  ): GroupRecentActivitiesQuery => ({
    findRecentActivities: (args) => {
      if (capturedArgs) {
        capturedArgs.current = args;
      }
      return okAsync(activities);
    },
  });

  it("所属団体が 0 件のときはクエリを実行せずに空配列を返す", async () => {
    let queryCalled = false;
    const groupRecentActivitiesQuery: GroupRecentActivitiesQuery = {
      findRecentActivities: () => {
        queryCalled = true;
        return okAsync([]);
      },
    };

    const result = await getGroupRecentActivitiesUseCase(
      {
        userGroupListQuery: createMockGroupListQuery([]),
        groupRecentActivitiesQuery,
      },
      { actorUserId: "usr_1", isStaff: false, now },
    );

    expect(result._unsafeUnwrap()).toEqual([]);
    expect(queryCalled).toBe(false);
  });

  it("所属団体の ID と役割、7日前の起点、上限5件を渡してクエリを実行する", async () => {
    const capturedArgs = { current: null as unknown };

    const result = await getGroupRecentActivitiesUseCase(
      {
        userGroupListQuery: createMockGroupListQuery([adminGroup, memberGroup]),
        groupRecentActivitiesQuery: createMockRecentActivitiesQuery([applyActivity], capturedArgs),
      },
      { actorUserId: "usr_1", isStaff: false, now },
    );

    expect(capturedArgs.current).toEqual({
      actorUserId: "usr_1",
      groups: [
        { id: "grp_1", role: MembershipRole.Admin },
        { id: "grp_2", role: MembershipRole.Member },
      ],
      since: new Date("2026-10-08T12:00:00.000Z"),
      limit: RECENT_ACTIVITIES_LIMIT,
    });
    const { actorName: _actorName, actedAsStaff: _actedAsStaff, ...rest } = applyActivity;
    expect(result._unsafeUnwrap()).toEqual([
      { ...rest, actor: { kind: "person", name: "メンバー2", actedAsStaff: false } },
    ]);
  });

  describe("操作者の表示（COND-012）", () => {
    it("事務局の横断権限による操作は、事務局でない人には「事務局」とだけ出す", async () => {
      const result = await getGroupRecentActivitiesUseCase(
        {
          userGroupListQuery: createMockGroupListQuery([adminGroup]),
          groupRecentActivitiesQuery: createMockRecentActivitiesQuery([staffEnableActivity]),
        },
        { actorUserId: "usr_1", isStaff: false, now },
      );

      expect(result._unsafeUnwrap()[0]?.actor).toEqual({ kind: "staff" });
    });

    it("事務局が見るときは、事務局員の名前を出す", async () => {
      const result = await getGroupRecentActivitiesUseCase(
        {
          userGroupListQuery: createMockGroupListQuery([adminGroup]),
          groupRecentActivitiesQuery: createMockRecentActivitiesQuery([staffEnableActivity]),
        },
        { actorUserId: "usr_1", isStaff: true, now },
      );

      expect(result._unsafeUnwrap()[0]?.actor).toEqual({
        kind: "person",
        name: "事務局員",
        actedAsStaff: true,
      });
    });
  });

  it("所属団体取得エラーを伝播する", async () => {
    const error: QueryError = {
      code: QueryErrorCode.DatabaseError,
      message: "DB error",
    };
    const userGroupListQuery: UserGroupListQuery = {
      findByUserId: () => errAsync(error),
    };

    const result = await getGroupRecentActivitiesUseCase(
      {
        userGroupListQuery,
        groupRecentActivitiesQuery: createMockRecentActivitiesQuery([]),
      },
      { actorUserId: "usr_1", isStaff: false, now },
    );

    expect(result._unsafeUnwrapErr()).toEqual(error);
  });

  it("クエリエラーを伝播する", async () => {
    const error: QueryError = {
      code: QueryErrorCode.DatabaseError,
      message: "DB error",
    };
    const groupRecentActivitiesQuery: GroupRecentActivitiesQuery = {
      findRecentActivities: () => errAsync(error),
    };

    const result = await getGroupRecentActivitiesUseCase(
      {
        userGroupListQuery: createMockGroupListQuery([adminGroup]),
        groupRecentActivitiesQuery,
      },
      { actorUserId: "usr_1", isStaff: false, now },
    );

    expect(result._unsafeUnwrapErr()).toEqual(error);
  });
});
