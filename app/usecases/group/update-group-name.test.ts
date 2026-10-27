import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import type { AuditLogDraft } from "~/domain/audit-log";
import type { Group, GroupError, UpdateGroupNameInput } from "~/domain/group";
import { GroupErrorCode, GroupStatus } from "~/domain/group";
import type { StoredMembership } from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { fakeGroupRepository } from "~/testing/fakes/group";
import { fakeMembershipRepository } from "~/testing/fakes/membership";
import { updateGroupNameUseCase } from "./update-group-name";

const testGroup: Group = {
  id: "grp_robotics",
  name: "ロボティクス開発プロジェクト",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

const adminMembership: StoredMembership = {
  id: "gm_adminMembership",
  groupId: testGroup.id,
  userId: "usr_admin",
  role: MembershipRole.Admin,
};

const memberMembership: StoredMembership = {
  id: "gm_memberMembership",
  groupId: testGroup.id,
  userId: "usr_member",
  role: MembershipRole.Member,
};

interface FakeGroupRepositoryOptions {
  readonly updateNameResult?: (
    input: UpdateGroupNameInput,
    auditLog: AuditLogDraft,
  ) => ResultAsync<Group, GroupError>;
  readonly findByIdResult?: (id: string) => ResultAsync<Group, GroupError>;
}

/** D1 を使わないダミーのグループリポジトリ */
const createFakeGroupRepository = (options: FakeGroupRepositoryOptions = {}) => {
  const findById = vi.fn((id: string) => {
    if (options.findByIdResult) {
      return options.findByIdResult(id);
    }
    return okAsync(testGroup);
  });

  const updateName = vi.fn((input: UpdateGroupNameInput, auditLog: AuditLogDraft) => {
    if (options.updateNameResult) {
      return options.updateNameResult(input, auditLog);
    }
    return okAsync({
      id: input.id,
      name: input.name,
      status: GroupStatus.Enabled,
      createdAt: testGroup.createdAt,
      updatedAt: input.updatedAt,
    });
  });

  const repository = fakeGroupRepository({
    findById,
    updateName,
  });

  return {
    repository,
    findById,
    updateName,
  };
};

/** D1 を使わないダミーのメンバーシップリポジトリ */
const createFakeMembershipRepository = (memberships: readonly StoredMembership[]) => {
  const findByGroupAndUser = vi.fn((groupId: string, userId: string) => {
    const found = memberships.find((m) => m.groupId === groupId && m.userId === userId);
    return okAsync(found ?? null);
  });

  const repository = fakeMembershipRepository({
    findByGroupAndUser,
  });

  return {
    repository,
    findByGroupAndUser,
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
    expect(groups.updateName).toHaveBeenCalledTimes(1);
    expect(groups.updateName.mock.calls[0]?.[0]).toEqual({
      id: testGroup.id,
      name: "新しい団体名",
      updatedAt: baseNow,
    });
    const updatedGroup = result._unsafeUnwrap();
    expect(updatedGroup.name).toBe("新しい団体名");
    expect(updatedGroup.updatedAt).toEqual(baseNow);
    const auditLog = groups.updateName.mock.calls[0]?.[1];
    expect(auditLog?.actedAsStaff).toBe(false);
    expect(auditLog?.changes).toEqual({
      name: { before: testGroup.name, after: "新しい団体名" },
    });
  });

  // 2. 事務局（isStaff: true）は所属していなくても変更でき、actedAsStaff が true になる（COND-012）
  it("事務局（isStaff: true）は所属していなくても変更でき、actedAsStaff が true になる", async () => {
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
    // acted_as_staff 判定のため所属を 1 回引く（COND-012）
    expect(memberships.findByGroupAndUser).toHaveBeenCalledTimes(1);
    expect(groups.updateName).toHaveBeenCalledTimes(1);
    expect(groups.updateName.mock.calls[0]?.[0]?.name).toBe("事務局による変更名");
    const auditLog = groups.updateName.mock.calls[0]?.[1];
    expect(auditLog?.actedAsStaff).toBe(true);
  });

  // 2b. 名前が変わっていない場合は書き込まず成功する（COND-013）
  it("名前が変わっていない場合は updateName を呼ばずに成功する", async () => {
    const groups = createFakeGroupRepository();
    const memberships = createFakeMembershipRepository([adminMembership]);

    const result = await updateGroupNameUseCase(
      { groupRepository: groups.repository, membershipRepository: memberships.repository },
      {
        groupId: testGroup.id,
        actorUserId: adminMembership.userId,
        isStaff: false,
        name: testGroup.name,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(groups.updateName).not.toHaveBeenCalled();
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
    expect(error.userMessage).toBe("団体情報の編集は、管理者と事務局のみ行えます。");
    expect(groups.updateName).not.toHaveBeenCalled();
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
    expect(groups.updateName).not.toHaveBeenCalled();
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
    expect(groups.updateName).not.toHaveBeenCalled();
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
      expect(memberships.findByGroupAndUser).not.toHaveBeenCalled();
      expect(groups.updateName).not.toHaveBeenCalled();
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
    expect(memberships.findByGroupAndUser).not.toHaveBeenCalled();
    expect(groups.updateName).not.toHaveBeenCalled();
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
    expect(memberships.findByGroupAndUser).not.toHaveBeenCalled();
    expect(groups.updateName).not.toHaveBeenCalled();
  });

  // 9. membershipRepository が DB エラーを返したときは DatabaseError になる（NotFound に潰れていないこと）
  it("membershipRepository が DB エラーを返したときは DatabaseError になる", async () => {
    const groups = createFakeGroupRepository();
    const failingMembershipRepo = fakeMembershipRepository({
      findByGroupAndUser: () =>
        errAsync({
          code: MembershipErrorCode.DatabaseError,
          message: "メンバーシップの取得に失敗しました。",
          cause: new Error("DB error"),
        }),
    });

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
    expect(groups.updateName).not.toHaveBeenCalled();
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
    expect(groups.updateName).toHaveBeenCalledTimes(1);
  });
});
