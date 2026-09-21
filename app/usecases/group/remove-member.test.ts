import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { GroupErrorCode } from "~/domain/group";
import type { Membership, MembershipError, MembershipRepository } from "~/domain/membership";
import { MembershipErrorCode, MembershipRole } from "~/domain/membership";
import { removeMemberUseCase } from "./remove-member";

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
  readonly removeResult?: (groupId: string, userId: string) => ResultAsync<number, MembershipError>;
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
  let lastRemoveInput: { groupId: string; userId: string } | null = null;

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
    updateRole: (_input) => {
      updateRoleCallCount += 1;
      return errAsync({
        code: MembershipErrorCode.DatabaseError,
        message: "このテストでは updateRole は使わない",
      });
    },
    remove: (groupId, userId) => {
      removeCallCount += 1;
      lastRemoveInput = { groupId, userId };
      if (options.removeResult) {
        return options.removeResult(groupId, userId);
      }
      return okAsync(1);
    },
  };

  return {
    repository,
    findByGroupAndUserCallCount: () => findByGroupAndUserCallCount,
    countAdminsCallCount: () => countAdminsCallCount,
    updateRoleCallCount: () => updateRoleCallCount,
    removeCallCount: () => removeCallCount,
    lastRemoveInput: () => lastRemoveInput,
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
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.removeCallCount()).toBe(1);
    expect(fake.lastRemoveInput()).toEqual({
      groupId: testGroupId,
      userId: regularMember.userId,
    });
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
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.countAdminsCallCount()).toBe(0);
    expect(fake.removeCallCount()).toBe(1);
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
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.countAdminsCallCount()).toBe(1);
    expect(fake.removeCallCount()).toBe(1);
    expect(fake.lastRemoveInput()).toEqual({
      groupId: testGroupId,
      userId: adminMembership2.userId,
    });
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
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.LastAdminRequired);
    expect(error.message).toBe(
      "管理者が 0 人になるため、最後の管理者は削除できません。先に別のメンバーを管理者にしてください。",
    );
    expect(fake.countAdminsCallCount()).toBe(1);
    expect(fake.removeCallCount()).toBe(0);
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
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.removeCallCount()).toBe(1);
    expect(fake.lastRemoveInput()?.userId).toBe(adminMembership1.userId);
    expect(result._unsafeUnwrap().removedUserId).toBe(adminMembership1.userId);
  });

  // 6. 事務局は所属していなくても削除できる
  it("事務局は所属していなくても削除できる", async () => {
    const fake = createFakeMembershipRepository([regularMember]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: "usr_staff",
        isStaff: true,
        targetUserId: regularMember.userId,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(fake.findByGroupAndUserCallCount()).toBe(1);
    expect(fake.removeCallCount()).toBe(1);
  });

  // 7. 一般メンバーが操作すると GroupForbidden になり、remove が 1 度も呼ばれない
  it("一般メンバーが操作すると GroupForbidden になり、remove は呼ばれない", async () => {
    const fake = createFakeMembershipRepository([regularMember, adminMembership1]);

    const result = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: regularMember.userId,
        isStaff: false,
        targetUserId: adminMembership1.userId,
      },
    );

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.GroupForbidden);
    expect(error.message).toBe("メンバーを削除できるのは管理者と事務局だけです。");
    expect(fake.removeCallCount()).toBe(0);
  });

  // 8. 所属していない人が操作すると GroupNotFound になり、存在しない団体のときと message まで一致する
  it("所属していない人が操作すると GroupNotFound になり、存在しない団体のときと message まで一致する（COND-011）", async () => {
    const fake = createFakeMembershipRepository([]);

    const notMemberResult = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: testGroupId,
        actorUserId: "usr_outsider",
        isStaff: false,
        targetUserId: "usr_target",
      },
    );

    const notExistsResult = await removeMemberUseCase(
      { membershipRepository: fake.repository },
      {
        groupId: "grp_not_exist",
        actorUserId: "usr_outsider",
        isStaff: false,
        targetUserId: "usr_target",
      },
    );

    expect(notMemberResult._unsafeUnwrapErr()).toEqual(notExistsResult._unsafeUnwrapErr());
    expect(fake.removeCallCount()).toBe(0);
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
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.MemberNotFound);
    expect(fake.removeCallCount()).toBe(0);
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
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.MemberNotFound);
    expect(fake.removeCallCount()).toBe(1);
  });

  it.each(["", "   "])(
    "targetUserId が %o のときは GroupInvalidInput になる",
    async (targetUserId) => {
      const fake = createFakeMembershipRepository([adminMembership1]);

      const result = await removeMemberUseCase(
        { membershipRepository: fake.repository },
        {
          groupId: testGroupId,
          actorUserId: adminMembership1.userId,
          isStaff: false,
          targetUserId,
        },
      );

      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.GroupInvalidInput);
      expect(fake.removeCallCount()).toBe(0);
    },
  );
});
