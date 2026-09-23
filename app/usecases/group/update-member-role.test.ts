import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { GroupErrorCode } from "~/domain/group";
import type {
  Membership,
  MembershipError,
  MembershipRepository,
  UpdateMembershipRoleInput,
} from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { updateMemberRoleUseCase } from "./update-member-role";

const testGroupId = "grp_robotics";

const adminMembership1: Membership = {
  groupId: testGroupId,
  userId: "usr_admin1",
  role: MembershipRole.Admin,
};

const adminMembership2: Membership = {
  groupId: testGroupId,
  userId: "usr_admin2",
  role: MembershipRole.Admin,
};

const regularMember: Membership = {
  groupId: testGroupId,
  userId: "usr_member1",
  role: MembershipRole.Member,
};

interface FakeMembershipRepositoryOptions {
  readonly countAdminsResult?: () => ResultAsync<number, MembershipError>;
  readonly updateRoleResult?: (
    input: UpdateMembershipRoleInput,
  ) => ResultAsync<number, MembershipError>;
}

/** D1 を使わないダミーのメンバーシップリポジトリ。呼び出し回数と引数を自前で記録する */
const createFakeMembershipRepository = (
  initialMemberships: readonly Membership[],
  options: FakeMembershipRepositoryOptions = {},
) => {
  let findByGroupAndUserCallCount = 0;
  let countAdminsCallCount = 0;
  let updateRoleCallCount = 0;
  let removeCallCount = 0;
  let lastUpdateRoleInput: UpdateMembershipRoleInput | null = null;

  const memberships = [...initialMemberships];

  const repository: MembershipRepository = {
    findByGroupAndUser: (groupId, userId) => {
      findByGroupAndUserCallCount += 1;
      const found = memberships.find((m) => m.groupId === groupId && m.userId === userId);
      return okAsync(found ?? null);
    },
    countAdmins: (_groupId) => {
      countAdminsCallCount += 1;
      if (options.countAdminsResult) {
        return options.countAdminsResult();
      }
      const count = memberships.filter((m) => m.role === MembershipRole.Admin).length;
      return okAsync(count);
    },
    updateRole: (input) => {
      updateRoleCallCount += 1;
      lastUpdateRoleInput = input;
      if (options.updateRoleResult) {
        return options.updateRoleResult(input);
      }
      return okAsync(1);
    },
    remove: (_groupId, _userId) => {
      removeCallCount += 1;
      return errAsync({
        code: MembershipErrorCode.DatabaseError,
        message: "このテストでは remove は使わない",
      });
    },
  };

  return {
    repository,
    findByGroupAndUserCallCount: () => findByGroupAndUserCallCount,
    countAdminsCallCount: () => countAdminsCallCount,
    updateRoleCallCount: () => updateRoleCallCount,
    removeCallCount: () => removeCallCount,
    lastUpdateRoleInput: () => lastUpdateRoleInput,
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
    expect(fake.updateRoleCallCount()).toBe(1);
    expect(fake.lastUpdateRoleInput()).toEqual({
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
    expect(fake.countAdminsCallCount()).toBe(0);
    expect(fake.updateRoleCallCount()).toBe(1);
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
    expect(fake.countAdminsCallCount()).toBe(1);
    expect(fake.updateRoleCallCount()).toBe(1);
    expect(fake.lastUpdateRoleInput()).toEqual({
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
    expect(fake.countAdminsCallCount()).toBe(1);
    expect(fake.updateRoleCallCount()).toBe(0);
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
    expect(fake.updateRoleCallCount()).toBe(1);
    expect(fake.lastUpdateRoleInput()?.userId).toBe(adminMembership1.userId);
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
    expect(fake.updateRoleCallCount()).toBe(0);
  });

  // 7. 事務局（isStaff: true）は所属していなくても操作でき、操作者の所属を引いていない
  it("事務局（isStaff: true）は所属していなくても操作でき、操作者の所属を引かない", async () => {
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
    // 操作者の所属チェックはスキップされ、対象メンバーの所属チェックのみ（1 回）
    expect(fake.findByGroupAndUserCallCount()).toBe(1);
    expect(fake.updateRoleCallCount()).toBe(1);
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
    expect(error.userMessage).toBe("メンバーの役割を変更できるのは管理者と事務局だけです。");
    expect(fake.updateRoleCallCount()).toBe(0);
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
    expect(fake.updateRoleCallCount()).toBe(0);
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
    expect(fake.updateRoleCallCount()).toBe(0);
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
      expect(fake.findByGroupAndUserCallCount()).toBe(0);
      expect(fake.countAdminsCallCount()).toBe(0);
      expect(fake.updateRoleCallCount()).toBe(0);
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
    expect(fake.updateRoleCallCount()).toBe(0);
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
    expect(fake.updateRoleCallCount()).toBe(1);
  });

  // 14. findByGroupAndUser が DB エラーを返したときは DatabaseError になる（NotFound に潰れていないこと）
  it("findByGroupAndUser が DB エラーを返したときは DatabaseError になる", async () => {
    const failingRepo: MembershipRepository = {
      findByGroupAndUser: () =>
        errAsync({
          code: MembershipErrorCode.DatabaseError,
          message: "DB error",
          cause: new Error("DB error"),
        }),
      countAdmins: () => errAsync({ code: MembershipErrorCode.DatabaseError, message: "使わない" }),
      updateRole: () => errAsync({ code: MembershipErrorCode.DatabaseError, message: "使わない" }),
      remove: () => errAsync({ code: MembershipErrorCode.DatabaseError, message: "使わない" }),
    };

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
