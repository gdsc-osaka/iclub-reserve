import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { GroupMembership, GroupRepository } from "~/domain/group";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { listMyGroupsUseCase } from "./list-my-groups";

/** 活動中の団体に管理者として所属している状態 */
const roboticsMembership: GroupMembership = {
  group: {
    id: "grp_robotics",
    name: "ロボティクス開発プロジェクト",
    status: GroupStatus.Enabled,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  },
  roles: [MembershipRole.Admin],
};

/**
 * D1 を使わないダミーのグループリポジトリ。
 *
 * 問い合わせに使われたユーザー ID を控えている。
 * 引数のユーザー以外の所属を取りに行っていないことを検証するために必要。
 */
const createFakeGroupRepository = (memberships: readonly GroupMembership[]) => {
  const askedUserIds: string[] = [];

  const repository: GroupRepository = {
    // このユースケースでは使わないが、GroupRepository を満たすために置いている
    findById: () => errAsync({ code: GroupErrorCode.GroupNotFound, message: "Group not found" }),

    findAllByMemberUserId: (userId) => {
      askedUserIds.push(userId);

      return okAsync(memberships);
    },
  };

  return { repository, askedUserIds };
};

describe("listMyGroupsUseCase", () => {
  it("所属しているグループを役割つきで返す", async () => {
    const groups = createFakeGroupRepository([roboticsMembership]);

    const result = await listMyGroupsUseCase(
      { groupRepository: groups.repository },
      { actorUserId: "usr_admin" },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([roboticsMembership]);
  });

  it("自分以外の所属は問い合わせない", async () => {
    const groups = createFakeGroupRepository([roboticsMembership]);

    await listMyGroupsUseCase({ groupRepository: groups.repository }, { actorUserId: "usr_admin" });

    // 引数で受け取ったユーザー ID 以外で問い合わせていないこと。
    // ここが崩れると、他人の所属団体が画面に出てしまう
    expect(groups.askedUserIds).toEqual(["usr_admin"]);
  });

  it("1 件も所属していないときは空の配列を返す", async () => {
    const groups = createFakeGroupRepository([]);

    const result = await listMyGroupsUseCase(
      { groupRepository: groups.repository },
      { actorUserId: "usr_newcomer" },
    );

    // 所属が 0 件なのは異常ではないので、エラーにしてはいけない。
    // エラーにすると、入ったばかりの人の画面が「見つかりません」になる
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual([]);
  });

  it("DB アクセスに失敗したら DATABASE_ERROR がそのまま伝播する", async () => {
    const repository: GroupRepository = {
      findById: () => errAsync({ code: GroupErrorCode.GroupNotFound, message: "Group not found" }),
      findAllByMemberUserId: () =>
        errAsync({
          code: GroupErrorCode.DatabaseError,
          message: "Failed to query the database",
          cause: new Error("D1 との接続に失敗しました"),
        }),
    };

    const result = await listMyGroupsUseCase(
      { groupRepository: repository },
      {
        actorUserId: "usr_admin",
      },
    );

    // 障害を「所属が 0 件」に潰すと、団体が消えたように見えて原因に気づけなくなる
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
  });
});
