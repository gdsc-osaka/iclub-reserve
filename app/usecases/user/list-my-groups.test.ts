import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { QueryErrorCode } from "~/query/error";
import type {
  UserGroupList,
  UserGroupListItem,
  UserGroupListQuery,
} from "~/query/user/user-group-list";
import { listMyGroupsUseCase } from "./list-my-groups";

/** 活動中の団体に管理者として所属している状態 */
const roboticsGroup: UserGroupListItem = {
  id: "grp_robotics",
  name: "ロボティクス開発プロジェクト",
  status: GroupStatus.Enabled,
  roles: [MembershipRole.Admin],
};

/**
 * D1 を使わないダミーの Query。
 *
 * 問い合わせに使われたユーザー ID を控えている。
 * 引数のユーザー以外の所属を取りに行っていないことを検証するために必要。
 */
const createFakeUserGroupListQuery = (groups: UserGroupList) => {
  const askedUserIds: string[] = [];

  const query: UserGroupListQuery = {
    findByUserId: (userId) => {
      askedUserIds.push(userId);

      return okAsync(groups);
    },
  };

  return { query, askedUserIds };
};

describe("listMyGroupsUseCase", () => {
  it("所属している団体を役割つきで返す", async () => {
    const groups = createFakeUserGroupListQuery([roboticsGroup]);

    const result = await listMyGroupsUseCase(
      { userGroupListQuery: groups.query },
      { actorUserId: "usr_admin" },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([roboticsGroup]);
  });

  it("自分以外の所属は問い合わせない", async () => {
    const groups = createFakeUserGroupListQuery([roboticsGroup]);

    await listMyGroupsUseCase({ userGroupListQuery: groups.query }, { actorUserId: "usr_admin" });

    // 引数で受け取ったユーザー ID 以外で問い合わせていないこと。
    // ここが崩れると、他人の所属団体が画面に出てしまう
    expect(groups.askedUserIds).toEqual(["usr_admin"]);
  });

  it("1 件も所属していないときは空の配列を返す", async () => {
    const groups = createFakeUserGroupListQuery([]);

    const result = await listMyGroupsUseCase(
      { userGroupListQuery: groups.query },
      { actorUserId: "usr_newcomer" },
    );

    // 所属が 0 件なのは異常ではないので、エラーにしてはいけない。
    // エラーにすると、入ったばかりの人の画面が「見つかりません」になる
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it("DB アクセスに失敗したら DATABASE_ERROR がそのまま伝播する", async () => {
    const query: UserGroupListQuery = {
      findByUserId: () =>
        errAsync({
          code: QueryErrorCode.DatabaseError,
          message: "所属している団体の取得に失敗しました。",
          cause: new Error("D1 との接続に失敗しました"),
        }),
    };

    const result = await listMyGroupsUseCase(
      { userGroupListQuery: query },
      {
        actorUserId: "usr_admin",
      },
    );

    // 障害を「所属が 0 件」に潰すと、団体が消えたように見えて原因に気づけなくなる
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.DatabaseError);
  });
});
