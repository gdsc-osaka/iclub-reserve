import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vite-plus/test";

import type { AuditLogDraft } from "~/domain/audit-log";
import { GroupErrorCode } from "~/domain/group";
import type {
  StoredMembership,
  MembershipError,
  UpdateMembershipRoleInput,
} from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { fakeMembershipRepository } from "~/testing/fakes";
import { updateMemberRoleUseCase } from "./update-member-role";

const testGroupId = "grp_robotics";

const adminMembership1: StoredMembership = {
  id: "gm_adminMembership1",
  groupId: testGroupId,
  userId: "usr_admin1",
  role: MembershipRole.Admin,
};

const adminMembership2: StoredMembership = {
  id: "gm_adminMembership2",
  groupId: testGroupId,
  userId: "usr_admin2",
  role: MembershipRole.Admin,
};

const regularMember: StoredMembership = {
  id: "gm_regularMember",
  groupId: testGroupId,
  userId: "usr_member1",
  role: MembershipRole.Member,
};

interface FakeMembershipRepositoryOptions {
  readonly countAdminsResult?: () => ResultAsync<number, MembershipError>;
  readonly updateRoleResult?: (
    input: UpdateMembershipRoleInput,
    auditLog: AuditLogDraft,
  ) => ResultAsync<number, MembershipError>;
}

/** D1 を使わないダミーのメンバーシップリポジトリ。呼び出しを vi.fn で記録する */
const createFakeMembershipRepository = (
  initialMemberships: readonly StoredMembership[],
  options: FakeMembershipRepositoryOptions = {},
) => {
  const memberships = [...initialMemberships];

  const findByGroupAndUser = vi.fn((groupId: string, userId: string) => {
    const found = memberships.find((m) => m.groupId === groupId && m.userId === userId);
    return okAsync(found ?? null);
  });

  const countAdmins = vi.fn((_groupId: string) => {
    if (options.countAdminsResult) {
      return options.countAdminsResult();
    }
    const count = memberships.filter((m) => m.role === MembershipRole.Admin).length;
    return okAsync(count);
  });

  const updateRole = vi.fn((input: UpdateMembershipRoleInput, auditLog: AuditLogDraft) => {
    if (options.updateRoleResult) {
      return options.updateRoleResult(input, auditLog);
    }
    return okAsync(1);
  });

  const repository = fakeMembershipRepository({
    findByGroupAndUser,
    countAdmins,
    updateRole,
  });

  return {
    repository,
    findByGroupAndUser,
    countAdmins,
    updateRole,
  };
};

describe("updateMemberRoleUseCase", () => {
  const baseNow = new Date("2026-09-21T12:00:00.000Z");

  // 1. 管理者は他のメンバーを管理者に昇格でき、updateRole に groupId / 対象の userId / admin / args.now が渡る
  it("管理者は他のメンバーを管理者に昇格でき、updateRole に groupId / 対象の userId / admin / now が渡る", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, regularMember]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: regularMember.userId,
        role: MembershipRole.Admin,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.updateRole).toHaveBeenCalledTimes(1);
    expect(fake.updateRole.mock.calls[0]?.[0]).toEqual({
      groupId: testGroupId,
      userId: regularMember.userId,
      role: MembershipRole.Admin,
      updatedAt: baseNow,
    });
  });

  // 2. 昇格のときは countAdmins が 1 度も呼ばれない（人数が減らない操作で往復を増やしていないこと）
  it("昇格のときは countAdmins が 1 度も呼ばれない（不要な DB 往復を削減）", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, regularMember]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: regularMember.userId,
        role: MembershipRole.Admin,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.countAdmins).not.toHaveBeenCalled();
    expect(fake.updateRole).toHaveBeenCalledTimes(1);
  });

  // 3. 管理者が 2 人いるとき、管理者 1 人を降格できる
  it("管理者が 2 人いるとき、管理者 1 人を降格できる", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, adminMembership2]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: adminMembership2.userId,
        role: MembershipRole.Member,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.countAdmins).toHaveBeenCalledTimes(1);
    expect(fake.updateRole).toHaveBeenCalledTimes(1);
    expect(fake.updateRole.mock.calls[0]?.[0]).toEqual({
      groupId: testGroupId,
      userId: adminMembership2.userId,
      role: MembershipRole.Member,
      updatedAt: baseNow,
    });
  });

  // 4. 管理者が 1 人しかいないとき、その 1 人の降格は LastAdminRequired になり、updateRole が 1 度も呼ばれない
  it("管理者が 1 人しかいないとき、その 1 人の降格は LastAdminRequired になり、updateRole は呼ばれない", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, regularMember]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: adminMembership1.userId,
        role: MembershipRole.Member,
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.LastAdminRequired);
    expect(error.userMessage).toBe(
      "管理者が 0 人になるため、最後の管理者は降格できません。先に別のメンバーを管理者にしてください。",
    );
    expect(fake.countAdmins).toHaveBeenCalledTimes(1);
    expect(fake.updateRole).not.toHaveBeenCalled();
  });

  // 5. 自分自身の降格は、他に管理者がいるなら成功する（対象 = 操作者で updateRole が呼ばれる）
  it("自分自身の降格は、他に管理者がいるなら成功する", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, adminMembership2]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: adminMembership1.userId,
        role: MembershipRole.Member,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.updateRole).toHaveBeenCalledTimes(1);
    expect(fake.updateRole.mock.calls[0]?.[0]?.userId).toBe(adminMembership1.userId);
  });

  // 6. 自分自身の降格でも、自分が最後の管理者なら LastAdminRequired になる
  it("自分自身の降格でも、自分が最後の管理者なら LastAdminRequired になる", async () => {
    const fake = createFakeMembershipRepository([adminMembership1]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: adminMembership1.userId,
        role: MembershipRole.Member,
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.LastAdminRequired);
    expect(fake.updateRole).not.toHaveBeenCalled();
  });

  // 7. 事務局（isStaff: true）は所属していなくても操作でき、actedAsStaff が true になる（COND-012）
  it("事務局（isStaff: true）は所属していなくても操作でき、actedAsStaff が true になる", async () => {
    const fake = createFakeMembershipRepository([regularMember]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: "usr_staff",
        isStaff: true,
        targetUserId: regularMember.userId,
        role: MembershipRole.Admin,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    // COND-012: 操作者の所属確認（1回）+ 対象メンバーの所属確認（1回）の計 2 回
    expect(fake.findByGroupAndUser).toHaveBeenCalledTimes(2);
    expect(fake.updateRole).toHaveBeenCalledTimes(1);
    const auditLog = fake.updateRole.mock.calls[0]?.[1];
    expect(auditLog?.actedAsStaff).toBe(true);
  });

  // 7b. 同じロールへの変更は書き込まず成功する（COND-013）
  it("同じロールへの変更は updateRole を呼ばずに成功する", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, regularMember]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: regularMember.userId,
        role: MembershipRole.Member,
        now: baseNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.updateRole).not.toHaveBeenCalled();
  });

  // 8. 一般メンバーが操作すると Forbidden になり、updateRole が 1 度も呼ばれない
  it("一般メンバーが操作すると Forbidden になり、updateRole は呼ばれない", async () => {
    const fake = createFakeMembershipRepository([regularMember, adminMembership1]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: regularMember.userId,
        isStaff: false,
        targetUserId: adminMembership1.userId,
        role: MembershipRole.Member,
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.Forbidden);
    expect(error.userMessage).toBe("メンバーの役割の変更は、管理者と事務局のみ行えます。");
    expect(fake.updateRole).not.toHaveBeenCalled();
  });

  // 9. 所属していない人が操作すると NotVisible になり、updateRole が 1 度も呼ばれない
  it("所属していない人が操作すると NotVisible になり、updateRole は呼ばれない", async () => {
    const fake = createFakeMembershipRepository([adminMembership1]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: "usr_outsider",
        isStaff: false,
        targetUserId: adminMembership1.userId,
        role: MembershipRole.Member,
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotVisible);
    expect(fake.updateRole).not.toHaveBeenCalled();
  });

  // 10. 所属していない人には、団体が存在するかに関わらず同じエラーを返す（団体を引きに行かない。COND-011）
  it("所属していない団体と存在しない団体で、返るエラーが message まで含めて完全に一致する（COND-011）", async () => {
    const fake = createFakeMembershipRepository([]);

    const notMemberResult = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: "usr_outsider",
        isStaff: false,
        targetUserId: "usr_target",
        role: MembershipRole.Admin,
        now: baseNow,
      },
    );

    const notExistsResult = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: "grp_not_exist",
        actorUserId: "usr_outsider",
        isStaff: false,
        targetUserId: "usr_target",
        role: MembershipRole.Admin,
        now: baseNow,
      },
    );

    expect(notMemberResult._unsafeUnwrapErr()).toEqual(notExistsResult._unsafeUnwrapErr());
    expect(fake.updateRole).not.toHaveBeenCalled();
  });

  // 11. it.each(["owner", "ADMIN", "admin,member", "", "  "]) で、不正な役割は InvalidInput になり、リポジトリが 1 つも呼ばれない（COND-007）
  it.each(["owner", "ADMIN", "admin,member", "", "  "])(
    "不正な役割 %o は InvalidInput になり、リポジトリは 1 つも呼ばれない",
    async (invalidRole) => {
      const fake = createFakeMembershipRepository([adminMembership1]);

      const result = await updateMemberRoleUseCase(
        { membershipRepository: fake.repository },
        {
          groupId: testGroupId,
          actorUserId: adminMembership1.userId,
          isStaff: false,
          targetUserId: regularMember.userId,
          role: invalidRole,
          now: baseNow,
        },
      );

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(GroupErrorCode.InvalidInput);
      expect(error.userMessage).toBe("指定できない役割です。");
      expect(fake.findByGroupAndUser).not.toHaveBeenCalled();
      expect(fake.countAdmins).not.toHaveBeenCalled();
      expect(fake.updateRole).not.toHaveBeenCalled();
    },
  );

  // 12. 対象がその団体に居ないときは MemberNotFound になる
  it("対象がその団体に居ないときは MemberNotFound になる", async () => {
    const fake = createFakeMembershipRepository([adminMembership1]);

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: "usr_not_in_group",
        role: MembershipRole.Admin,
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.MemberNotFound);
    expect(error.message).toBe("対象のメンバーはこの団体に所属していません。");
    expect(fake.updateRole).not.toHaveBeenCalled();
  });

  // 13. updateRole が 0 件を返したときは MemberNotFound になる
  it("updateRole が 0 件を返したときは MemberNotFound になる", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, regularMember], {
      updateRoleResult: () => okAsync(0),
    });

    const result = await updateMemberRoleUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: regularMember.userId,
        role: MembershipRole.Admin,
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.MemberNotFound);
    expect(error.message).toBe("対象のメンバーはこの団体に所属していません。");
    expect(fake.updateRole).toHaveBeenCalledTimes(1);
  });

  // 14. findByGroupAndUser が DB エラーを返したときは DatabaseError になる（NotFound に潰れていないこと）
  it("findByGroupAndUser が DB エラーを返したときは DatabaseError になる", async () => {
    const failingRepo = fakeMembershipRepository({
      findByGroupAndUser: () =>
        errAsync({
          code: MembershipErrorCode.DatabaseError,
          message: "DB error",
          cause: new Error("DB error"),
        }),
    });

    const result = await updateMemberRoleUseCase(
      { membershipRepository: failingRepo },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: regularMember.userId,
        role: MembershipRole.Admin,
        now: baseNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.DatabaseError);
  });
});
