import { okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import type { AuditLogDraft } from "~/domain/audit-log";
import { GroupErrorCode } from "~/domain/group";
import type { StoredMembership, MembershipError } from "~/domain/membership";
import { MembershipRole } from "~/domain/membership";
import { fakeMembershipRepository } from "~/testing/fakes/membership";
import { removeMemberUseCase } from "./remove-member";

const testGroupId = "grp_robotics";
const testNow = new Date("2026-04-01T10:00:00.000Z");

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
  readonly removeResult?: (
    groupId: string,
    userId: string,
    auditLog: AuditLogDraft,
  ) => ResultAsync<number, MembershipError>;
}

/** D1 を使わないダミーのメンバーシップリポジトリ */
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

  const remove = vi.fn((groupId: string, userId: string, auditLog: AuditLogDraft) => {
    if (options.removeResult) {
      return options.removeResult(groupId, userId, auditLog);
    }
    return okAsync(1);
  });

  const repository = fakeMembershipRepository({
    findByGroupAndUser,
    countAdmins,
    remove,
  });

  return {
    repository,
    findByGroupAndUser,
    countAdmins,
    remove,
  };
};

describe("removeMemberUseCase", () => {
  // 1. 管理者は一般メンバーを削除でき、remove に groupId と対象の userId が渡る
  it("管理者は一般メンバーを削除でき、remove に groupId と対象の userId が渡る", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, regularMember]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: regularMember.userId,
        now: testNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.remove).toHaveBeenCalledTimes(1);
    expect(fake.remove.mock.calls[0]?.[0]).toBe(testGroupId);
    expect(fake.remove.mock.calls[0]?.[1]).toBe(regularMember.userId);
    expect(result._unsafeUnwrap()).toEqual({
      removedUserId: regularMember.userId,
    });
  });

  // 2. 一般メンバーを削除するときは countAdmins が 1 度も呼ばれない
  it("一般メンバーを削除するときは countAdmins が 1 度も呼ばれない", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, regularMember]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: regularMember.userId,
        now: testNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.countAdmins).not.toHaveBeenCalled();
    expect(fake.remove).toHaveBeenCalledTimes(1);
  });

  // 3. 管理者が 2 人いるとき、管理者 1 人を削除できる
  it("管理者が 2 人いるとき、管理者 1 人を削除できる", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, adminMembership2]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: adminMembership2.userId,
        now: testNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.countAdmins).toHaveBeenCalledTimes(1);
    expect(fake.remove).toHaveBeenCalledTimes(1);
    expect(fake.remove.mock.calls[0]?.[0]).toBe(testGroupId);
    expect(fake.remove.mock.calls[0]?.[1]).toBe(adminMembership2.userId);
  });

  // 4. 管理者が 1 人しかいないとき、その 1 人の削除は LastAdminRequired になり、remove が 1 度も呼ばれない
  it("管理者が 1 人しかいないとき、その 1 人の削除は LastAdminRequired になり、remove は呼ばれない", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, regularMember]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: adminMembership1.userId,
        now: testNow,
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.LastAdminRequired);
    expect(error.userMessage).toBe(
      "管理者が 0 人になるため、最後の管理者は削除できません。先に別のメンバーを管理者にしてください。",
    );
    expect(fake.countAdmins).toHaveBeenCalledTimes(1);
    expect(fake.remove).not.toHaveBeenCalled();
  });

  // 5. 自分自身の削除は、他に管理者がいるなら成功し、removedUserId が操作者の ID になる
  it("自分自身の削除は、他に管理者がいるなら成功し、removedUserId が操作者の ID になる", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, adminMembership2]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: adminMembership1.userId,
        now: testNow,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.remove).toHaveBeenCalledTimes(1);
    expect(fake.remove.mock.calls[0]?.[1]).toBe(adminMembership1.userId);
    expect(result._unsafeUnwrap().removedUserId).toBe(adminMembership1.userId);
  });

  // 6. 事務局は所属していなくても削除でき、actedAsStaff が true になる（COND-012）
  it("事務局は所属していなくても削除できる", async () => {
    const fake = createFakeMembershipRepository([regularMember]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: "usr_staff",
        isStaff: true,
        targetUserId: regularMember.userId,
        now: testNow,
      },
    );

    expect(result.isOk()).toBe(true);
    // COND-012: 操作者の所属確認（1回）+ 削除対象メンバーの存在確認（1回）の計 2 回
    expect(fake.findByGroupAndUser).toHaveBeenCalledTimes(2);
    expect(fake.remove).toHaveBeenCalledTimes(1);
    const auditLog = fake.remove.mock.calls[0]?.[2];
    expect(auditLog?.actedAsStaff).toBe(true);
  });

  // 7. 一般メンバーが操作すると Forbidden になり、remove が 1 度も呼ばれない
  it("一般メンバーが操作すると Forbidden になり、remove は呼ばれない", async () => {
    const fake = createFakeMembershipRepository([regularMember, adminMembership1]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: regularMember.userId,
        isStaff: false,
        targetUserId: adminMembership1.userId,
        now: testNow,
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.Forbidden);
    expect(error.userMessage).toBe("メンバーを削除できるのは管理者と事務局だけです。");
    expect(fake.remove).not.toHaveBeenCalled();
  });

  // 8. 所属していない人には、団体が存在するかに関わらず同じエラーを返す（団体を引きに行かない）
  it("所属していない人には、団体が存在するかに関わらず同じエラーを返す（COND-011）", async () => {
    const fake = createFakeMembershipRepository([]);

    const notMemberResult = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: "usr_outsider",
        isStaff: false,
        targetUserId: "usr_target",
        now: testNow,
      },
    );

    const notExistsResult = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: "grp_not_exist",
        actorUserId: "usr_outsider",
        isStaff: false,
        targetUserId: "usr_target",
        now: testNow,
      },
    );

    expect(notMemberResult._unsafeUnwrapErr()).toEqual(notExistsResult._unsafeUnwrapErr());
    expect(fake.remove).not.toHaveBeenCalled();
  });

  // 9. 対象が居ないとき／remove が 0 件を返したときは MemberNotFound になる
  it("対象が居ないときは MemberNotFound になる", async () => {
    const fake = createFakeMembershipRepository([adminMembership1]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: "usr_not_in_group",
        now: testNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.MemberNotFound);
    expect(fake.remove).not.toHaveBeenCalled();
  });

  it("remove が 0 件を返したときは MemberNotFound になる", async () => {
    const fake = createFakeMembershipRepository([adminMembership1, regularMember], {
      removeResult: () => okAsync(0),
    });

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId: regularMember.userId,
        now: testNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.MemberNotFound);
    expect(fake.remove).toHaveBeenCalledTimes(1);
  });

  it.each(["", "   "])("targetUserId が %o のときは InvalidInput になる", async (targetUserId) => {
    const fake = createFakeMembershipRepository([adminMembership1]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: adminMembership1.userId,
        isStaff: false,
        targetUserId,
        now: testNow,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidInput);
    expect(fake.remove).not.toHaveBeenCalled();
  });
});
