import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { GroupStatus } from "~/domain/group";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  GroupSearchCriteria,
  GroupSearchList,
  GroupSearchQuery,
} from "~/query/group/group-search";
import { searchGroupsUseCase, type SearchGroupsDeps } from "./search-groups";

const fakeItems: GroupSearchList = [
  {
    id: "grp_01",
    name: "ロボティクス開発プロジェクト",
    status: GroupStatus.Pending,
    memberCount: 3,
    createdAt: new Date("2026-09-20T10:00:00Z"),
  },
  {
    id: "grp_02",
    name: "AI ハッカソンチーム",
    status: GroupStatus.Enabled,
    memberCount: 5,
    createdAt: new Date("2026-09-18T10:00:00Z"),
  },
];

const fakeCounts: Record<GroupStatus, number> = {
  [GroupStatus.Pending]: 1,
  [GroupStatus.Enabled]: 1,
  [GroupStatus.Disabled]: 0,
};

const createDeps = (overrides?: {
  items?: GroupSearchList;
  counts?: Record<GroupStatus, number>;
  error?: QueryError;
}) => {
  const groupSearchQuery: GroupSearchQuery = {
    findList: vi.fn((_criteria: GroupSearchCriteria) => {
      if (overrides?.error) return errAsync(overrides.error);
      return okAsync(overrides?.items ?? fakeItems);
    }),
    countByStatus: vi.fn(() => {
      if (overrides?.error) return errAsync(overrides.error);
      return okAsync(overrides?.counts ?? fakeCounts);
    }),
  };

  return {
    deps: { groupSearchQuery } satisfies SearchGroupsDeps,
    groupSearchQuery,
  };
};

describe("searchGroupsUseCase（SCR-008: 事務局向け全団体一覧取得）", () => {
  it("事務局でない人は Forbidden で Query が呼ばれない（COND-009）", async () => {
    const { deps, groupSearchQuery } = createDeps();

    const result = await searchGroupsUseCase(deps, {
      actorUserId: "usr_student",
      isStaff: false,
      status: GroupStatus.Pending,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
    expect(groupSearchQuery.findList).not.toHaveBeenCalled();
    expect(groupSearchQuery.countByStatus).not.toHaveBeenCalled();
  });

  it("事務局スタッフは全団体一覧と各ステータス件数を取得できる", async () => {
    const { deps, groupSearchQuery } = createDeps();

    const result = await searchGroupsUseCase(deps, {
      actorUserId: "usr_staff",
      isStaff: true,
      status: GroupStatus.Pending,
    });

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.items).toEqual(fakeItems);
    expect(value.counts).toEqual(fakeCounts);
    expect(groupSearchQuery.findList).toHaveBeenCalledWith({ status: GroupStatus.Pending });
    expect(groupSearchQuery.countByStatus).toHaveBeenCalled();
  });

  it("status に null を指定すると全状態を取得する", async () => {
    const { deps, groupSearchQuery } = createDeps();

    const result = await searchGroupsUseCase(deps, {
      actorUserId: "usr_staff",
      isStaff: true,
      status: null,
    });

    expect(result.isOk()).toBe(true);
    expect(groupSearchQuery.findList).toHaveBeenCalledWith({ status: null });
  });

  it("Query で DB エラーが発生した場合はそのままエラーを返す", async () => {
    const dbError: QueryError = {
      code: QueryErrorCode.DatabaseError,
      message: "DB エラー",
    };
    const { deps } = createDeps({ error: dbError });

    const result = await searchGroupsUseCase(deps, {
      actorUserId: "usr_staff",
      isStaff: true,
      status: GroupStatus.Pending,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(dbError);
  });
});
