import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import type { Group, GroupError, GroupRepository, UpdateGroupNameInput } from "~/domain/group";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import type { Membership, MembershipRepository } from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { updateGroupNameUseCase } from "./update-group-name";

const testGroup: Group = {
  id: "grp_robotics",
  name: "ロボティクス開発プロジェクト",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const adminMembership: Membership = {
  groupId: testGroup.id,
  userId: "usr_admin",
  role: MembershipRole.Admin,
};

const memberMembership: Membership = {
  groupId: testGroup.id,
  userId: "usr_member",
  role: MembershipRole.Member,
};

interface FakeGroupRepositoryOptions {
  readonly updateNameResult?: (input: UpdateGroupNameInput) => ResultAsync<Group, GroupError>;
}

/** D1 を使わないダミーのグループリポジトリ。呼び出し回数と引数を自前で記録する */
const createFakeGroupRepository = (options: FakeGroupRepositoryOptions = {}) => {
  let findByIdCallCount = 0;
  let updateNameCallCount = 0;
  let lastUpdateNameInput: UpdateGroupNameInput | null = null;

  const repository: GroupRepository = {
    findById: (_id) => {
      findByIdCallCount += 1;
      return errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "このテストでは findById は使わない",
      });
    },
    updateName: (input) => {
      updateNameCallCount += 1;
      lastUpdateNameInput = input;
      if (options.updateNameResult) {
        return options.updateNameResult(input);
      }
      return okAsync({
        id: input.id,
        name: input.name,
        status: GroupStatus.Enabled,
        createdAt: testGroup.createdAt,
        updatedAt: input.updatedAt,
      });
    },
    create: () =>
      errAsync({
        code: GroupErrorCode.DatabaseError,
        message: "このテストでは create は使わない",
      }),
  };

  return {
    repository,
    updateNameCallCount: () => updateNameCallCount,
    findByIdCallCount: () => findByIdCallCount,
    lastUpdateNameInput: () => lastUpdateNameInput,
  };
};

/** D1 を使わないダミーのメンバーシップリポジトリ */
const createFakeMembershipRepository = (memberships: readonly Membership[]) => {
  let callCount = 0;

  const repository: MembershipRepository = {
    findByGroupAndUser: (groupId, userId) => {
      callCount += 1;
      const found = memberships.find((m) => m.groupId === groupId && m.userId === userId);
      return okAsync(found ?? null);
    },
    // このテストでは呼ばれない前提。呼ばれたら失敗して気付けるようにしてある
    countAdmins: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    updateRole: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    remove: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
  };

  return {
    repository,
    callCount: () => callCount,
  };
};

describe("updateGroupNameUseCase", () => {
  const baseNow = new Date("2026-09-21T12:00:00.000Z");

  // 1. 管理者は名前を変更でき、updateName に trim 済みの名前と args.now が渡る
  it("管理者は名前を変更でき、updateName に trim 済みの名前と now が渡る", async () => {
    const groups = createFakeGroupRepository();
    const memberships = createFakeMembershipRepository([adminMembership]);

    const result = await updateGroupNameUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        name: "  新しい団体名  ",
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(groups.updateNameCallCount()).toBe(1);
    expect(groups.lastUpdateNameInput()).toEqual({
      id: testGroup.id,
      name: "新しい団体名",
      updatedAt: baseNow,
    });
    const updatedGroup = result._unsafeUnwrap();
    expect(updatedGroup.name).toBe("新しい団体名");
    expect(updatedGroup.updatedAt).toEqual(baseNow);
  });

  // 2. 事務局（isStaff: true）は所属していなくても変更でき、membershipRepository が 1 度も呼ばれていない
  it("事務局（isStaff: true）は所属していなくても変更でき、membershipRepository が 1 度も呼ばれない", async () => {
    const groups = createFakeGroupRepository();
    const memberships = createFakeMembershipRepository([]);

    const result = await updateGroupNameUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      {
        groupId: testGroup.id,
        actorUserId: "usr_staff",
        isStaff: true,
        name: "事務局による変更名",
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(memberships.callCount()).toBe(0);
    expect(groups.updateNameCallCount()).toBe(1);
    expect(groups.lastUpdateNameInput()?.name).toBe("事務局による変更名");
  });

  // 3. 一般メンバーは Forbidden になり、updateName が 1 度も呼ばれていない
  it("一般メンバーは Forbidden になり、updateName は呼ばれない", async () => {
    const groups = createFakeGroupRepository();
    const memberships = createFakeMembershipRepository([memberMembership]);

    const result = await updateGroupNameUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      {
        groupId: testGroup.id,
        actorUserId: memberMembership.userId,
        isStaff: false,
        name: "メンバーによる勝手な変更",
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.Forbidden);
    expect(error.userMessage).toBe("団体情報を編集できるのは管理者と事務局だけです。");
    expect(groups.updateNameCallCount()).toBe(0);
  });

  // 4. 所属していない人（membership が null）は NotVisible になり、updateName が 1 度も呼ばれていない
  it("所属していない人は NotVisible になり、updateName は呼ばれない", async () => {
    const groups = createFakeGroupRepository();
    const memberships = createFakeMembershipRepository([]);

    const result = await updateGroupNameUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      {
        groupId: testGroup.id,
        actorUserId: "usr_outsider",
        isStaff: false,
        name: "部外者による変更",
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.NotVisible);
    expect(groups.updateNameCallCount()).toBe(0);
  });

  // 5. 4 のエラーが、存在しない団体を指定したときのエラーと message まで含めて完全に一致する（COND-011）
  it("所属していない団体と存在しない団体で、返るエラーが message まで含めて完全に一致する（COND-011）", async () => {
    const groups = createFakeGroupRepository();
    const memberships = createFakeMembershipRepository([]);
    const deps = {
      groupRepository: groups.repository,
      membershipRepository: memberships.repository,
    };

    // 存在するが所属していない団体
    const notMember = await updateGroupNameUseCase(deps, {
      groupId: testGroup.id,
      actorUserId: "usr_outsider",
      isStaff: false,
      name: "更新名",
      now: baseNow,
    });

    // 存在しない団体
    const notExists = await updateGroupNameUseCase(deps, {
      groupId: "grp_does_not_exist",
      actorUserId: "usr_outsider",
      isStaff: false,
      name: "更新名",
      now: baseNow,
    });

    expect(notMember._unsafeUnwrapErr()).toEqual(notExists._unsafeUnwrapErr());
    expect(groups.updateNameCallCount()).toBe(0);
  });

  // 6. it.each(["", "   "]) で、空の groupId は NotFound になり、リポジトリが 1 つも呼ばれていない
  it.each(["", "   "])(
    "groupId が %o のときはリポジトリを 1 つも呼ばずに NotFound になる",
    async (groupId) => {
      const groups = createFakeGroupRepository();
      const memberships = createFakeMembershipRepository([adminMembership]);

      const result = await updateGroupNameUseCase(
        { groupRepository: groups.repository, membershipRepository: memberships.repository },
        {
          groupId,
          actorUserId: adminMembership.userId,
          isStaff: false,
          name: "新しい団体名",
          now: baseNow,
        },
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotFound);
      expect(memberships.callCount()).toBe(0);
      expect(groups.updateNameCallCount()).toBe(0);
    },
  );

  // 7. 団体名が空のときは InvalidInput になり、リポジトリが 1 つも呼ばれていない（検証が認可より先＝DB を引かない、の確認）
  it("団体名が空のときは InvalidInput になり、リポジトリは 1 つも呼ばれない", async () => {
    const groups = createFakeGroupRepository();
    const memberships = createFakeMembershipRepository([adminMembership]);

    const result = await updateGroupNameUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        name: "   ",
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidInput);
    // 認可判定より先に検証しているため、リポジトリはいずれも呼ばれない
    expect(memberships.callCount()).toBe(0);
    expect(groups.updateNameCallCount()).toBe(0);
  });

  // 8. 団体名が長すぎるとき（65 文字）は InvalidInput になる
  it("団体名が 65 文字のときは InvalidInput になる", async () => {
    const groups = createFakeGroupRepository();
    const memberships = createFakeMembershipRepository([adminMembership]);

    const result = await updateGroupNameUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        name: "あ".repeat(65),
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidInput);
    expect(memberships.callCount()).toBe(0);
    expect(groups.updateNameCallCount()).toBe(0);
  });

  // 9. membershipRepository が DB エラーを返したときは DatabaseError になる（NotFound に潰れていないこと）
  it("membershipRepository が DB エラーを返したときは DatabaseError になる", async () => {
    const groups = createFakeGroupRepository();
    const failingMembershipRepo: MembershipRepository = {
      findByGroupAndUser: () =>
        errAsync({
          code: MembershipErrorCode.DatabaseError,
          message: "メンバーシップの取得に失敗しました。",
          cause: new Error("DB error"),
        }),
      // このテストでは呼ばれない前提。呼ばれたら失敗して気付けるようにしてある
      countAdmins: () =>
        errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
      updateRole: () =>
        errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
      remove: () =>
        errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    };

    const result = await updateGroupNameUseCase(
      { groupRepository: groups.repository, membershipRepository: failingMembershipRepo },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        name: "有効な名前",
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
    expect(groups.updateNameCallCount()).toBe(0);
  });

  // 10. updateName が NotFound を返したとき（更新 0 件）は、そのまま NotFound が返る
  it("updateName が NotFound を返したとき（更新 0 件）は、そのまま NotFound が返る", async () => {
    const groups = createFakeGroupRepository({
      updateNameResult: () =>
        errAsync({
          code: GroupErrorCode.NotFound,
          message: "Group not found",
        }),
    });
    const memberships = createFakeMembershipRepository([adminMembership]);

    const result = await updateGroupNameUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        name: "有効な名前",
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotFound);
    expect(groups.updateNameCallCount()).toBe(1);
  });
});
