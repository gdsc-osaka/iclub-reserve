import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { Group, GroupRepository } from "~/domain/group";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import type { Membership, MembershipRepository } from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { getGroupUseCase } from "./get-group";

const roboticsGroup: Group = {
  id: "grp_robotics",
  name: "ロボティクス開発プロジェクト",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

/** grp_robotics の管理者 */
const adminMembership: Membership = {
  groupId: roboticsGroup.id,
  userId: "usr_admin",
  roles: [MembershipRole.Admin],
};

/** grp_robotics の一般メンバー */
const memberMembership: Membership = {
  groupId: roboticsGroup.id,
  userId: "usr_member",
  roles: [MembershipRole.Member],
};

/**
 * D1 を使わないダミーのグループリポジトリ。
 *
 * findById が呼ばれた回数を数えている。所属していない人に対して
 * グループを取りに行っていないことを検証するために必要。
 * 取りに行ってしまうと、問い合わせの有無や応答時間の差から
 * グループが存在するかどうかを推測できてしまう。
 */
const createFakeGroupRepository = (groups: Group[]) => {
  let findByIdCallCount = 0;

  const repository: GroupRepository = {
    findById: (id) => {
      findByIdCallCount += 1;
      const found = groups.find((group) => group.id === id);

      if (found === undefined) {
        return errAsync({
          code: GroupErrorCode.GroupNotFound,
          message: "Group not found",
        });
      }

      return okAsync(found);
    },

    // このユースケースでは使わないが、GroupRepository を満たすために置いている
    findAllByMemberUserId: () => okAsync([]),
  };

  return { repository, findByIdCallCount: () => findByIdCallCount };
};

/** D1 を使わないダミーのメンバーシップリポジトリ */
const createFakeMembershipRepository = (memberships: Membership[]) => {
  let callCount = 0;

  const repository: MembershipRepository = {
    findByGroupAndUser: (groupId, userId) => {
      callCount += 1;
      const found = memberships.find((m) => m.groupId === groupId && m.userId === userId);

      return okAsync(found ?? null);
    },
  };

  return { repository, callCount: () => callCount };
};

/** 必ず DB エラーを返すダミーのメンバーシップリポジトリ */
const createFailingMembershipRepository = (): MembershipRepository => ({
  findByGroupAndUser: () =>
    errAsync({
      code: MembershipErrorCode.DatabaseError,
      message: "メンバーシップの取得に失敗しました。",
      cause: new Error("D1 との接続に失敗しました"),
    }),
});

/** 必ず DB エラーを返すダミーのグループリポジトリ */
const createFailingGroupRepository = (): GroupRepository => ({
  findById: () =>
    errAsync({
      code: GroupErrorCode.DatabaseError,
      message: "グループ情報の取得に失敗しました。",
      cause: new Error("D1 との接続に失敗しました"),
    }),

  // このユースケースでは使わないが、GroupRepository を満たすために置いている
  findAllByMemberUserId: () => okAsync([]),
});

describe("getGroupUseCase", () => {
  it("管理者は自分のグループを取得できる", async () => {
    const groups = createFakeGroupRepository([roboticsGroup]);
    const memberships = createFakeMembershipRepository([adminMembership]);

    const result = await getGroupUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      { groupId: roboticsGroup.id, actorUserId: adminMembership.userId },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(roboticsGroup);
  });

  it("管理者でない一般メンバーも自分のグループを取得できる", async () => {
    const groups = createFakeGroupRepository([roboticsGroup]);
    const memberships = createFakeMembershipRepository([memberMembership]);

    const result = await getGroupUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      { groupId: roboticsGroup.id, actorUserId: memberMembership.userId },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(roboticsGroup);
  });

  it("所属していないグループは GROUP_NOT_FOUND になり、グループを取りに行かない", async () => {
    const groups = createFakeGroupRepository([roboticsGroup]);
    const memberships = createFakeMembershipRepository([]);

    const result = await getGroupUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      { groupId: roboticsGroup.id, actorUserId: "usr_outsider" },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.GroupNotFound);
    // 存在の有無が問い合わせの回数に現れないようにする
    expect(groups.findByIdCallCount()).toBe(0);
  });

  it("所属していないグループと存在しないグループを外から区別できない", async () => {
    const groups = createFakeGroupRepository([roboticsGroup]);
    const memberships = createFakeMembershipRepository([]);
    const deps = {
      groupRepository: groups.repository,
      membershipRepository: memberships.repository,
    };

    // 存在するが所属していないグループ
    const notMember = await getGroupUseCase(deps, {
      groupId: roboticsGroup.id,
      actorUserId: "usr_outsider",
    });

    // そもそも存在しないグループ
    const notExists = await getGroupUseCase(deps, {
      groupId: "grp_does_not_exist",
      actorUserId: "usr_outsider",
    });

    // メッセージまで含めて完全に同じであること。片方だけ「所属していません」と
    // 書いてしまうと、そこからグループの存在を読み取られる
    expect(notMember._unsafeUnwrapErr()).toEqual(notExists._unsafeUnwrapErr());
    expect(groups.findByIdCallCount()).toBe(0);
  });

  it("メンバーシップの取得に失敗したら DATABASE_ERROR になる", async () => {
    const groups = createFakeGroupRepository([roboticsGroup]);

    const result = await getGroupUseCase(
      {
        groupRepository: groups.repository,
        membershipRepository: createFailingMembershipRepository(),
      },
      { groupId: roboticsGroup.id, actorUserId: adminMembership.userId },
    );

    expect(result.isErr()).toBe(true);
    // DB エラーを GROUP_NOT_FOUND に潰すと、障害が 404 として表示されて気づけなくなる
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
    expect(groups.findByIdCallCount()).toBe(0);
  });

  it("グループの取得に失敗したら DATABASE_ERROR がそのまま伝播する", async () => {
    const memberships = createFakeMembershipRepository([adminMembership]);

    const result = await getGroupUseCase(
      {
        groupRepository: createFailingGroupRepository(),
        membershipRepository: memberships.repository,
      },
      { groupId: roboticsGroup.id, actorUserId: adminMembership.userId },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
  });

  it.each(["", "   "])("グループ ID が %o のときは何も問い合わせずに終わる", async (groupId) => {
    const groups = createFakeGroupRepository([roboticsGroup]);
    const memberships = createFakeMembershipRepository([adminMembership]);

    const result = await getGroupUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      { groupId, actorUserId: adminMembership.userId },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.GroupNotFound);
    expect(memberships.callCount()).toBe(0);
    expect(groups.findByIdCallCount()).toBe(0);
  });
});
