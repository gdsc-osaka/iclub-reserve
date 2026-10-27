import { okAsync } from "neverthrow";
import { describe, expect, it } from "vite-plus/test";

import type { StoredGroupCalendarFeed } from "~/domain/calendar";
import { GroupErrorCode, GroupStatus, type Group } from "~/domain/group";
import { MembershipRole, type StoredMembership } from "~/domain/membership";
import { fakeGroupCalendarFeedRepository } from "~/testing/fakes/calendar";
import { fakeGroupRepository } from "~/testing/fakes/group";
import { fakeMembershipRepository } from "~/testing/fakes/membership";
import { issueGroupCalendarFeedUseCase } from "./issue-group-calendar-feed";

const testGroup: Group = {
  id: "grp_robotics",
  name: "ロボティクス班",
  status: GroupStatus.Enabled,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const memberMembership: StoredMembership = {
  id: "mem_1",
  groupId: testGroup.id,
  userId: "usr_member",
  role: MembershipRole.Member,
};

const adminMembership: StoredMembership = {
  id: "mem_2",
  groupId: testGroup.id,
  userId: "usr_admin",
  role: MembershipRole.Admin,
};

const NOW = new Date("2026-05-01T10:00:00.000Z");

describe("issueGroupCalendarFeedUseCase", () => {
  it("一般メンバー（Member）が初回発行すると新しいトークンが返る", async () => {
    let issuedFeed: StoredGroupCalendarFeed | undefined;

    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(memberMembership),
      }),
      groupCalendarFeedRepository: fakeGroupCalendarFeedRepository({
        issue: (input) => {
          issuedFeed = {
            id: "feed_1",
            membershipId: input.membershipId,
            token: input.token,
            createdAt: input.now,
            updatedAt: input.now,
          };
          return okAsync(issuedFeed);
        },
      }),
      generateToken: () => "generated_token_123",
    };

    const result = await issueGroupCalendarFeedUseCase(deps, {
      groupId: testGroup.id,
      actorUserId: memberMembership.userId,
      isStaff: false,
      now: NOW,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().token).toBe("generated_token_123");
    expect(issuedFeed?.membershipId).toBe(memberMembership.id);
  });

  it("管理者（Admin）も同様に購読 URL を発行できる（役割を問わない）", async () => {
    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(adminMembership),
      }),
      groupCalendarFeedRepository: fakeGroupCalendarFeedRepository({
        issue: (input) =>
          okAsync({
            id: "feed_admin",
            membershipId: input.membershipId,
            token: input.token,
            createdAt: input.now,
            updatedAt: input.now,
          }),
      }),
      generateToken: () => "admin_token_456",
    };

    const result = await issueGroupCalendarFeedUseCase(deps, {
      groupId: testGroup.id,
      actorUserId: adminMembership.userId,
      isStaff: false,
      now: NOW,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().token).toBe("admin_token_456");
  });

  it("所属していない一般利用者には NotVisible を返す", async () => {
    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(null),
      }),
      groupCalendarFeedRepository: fakeGroupCalendarFeedRepository(),
      generateToken: () => "unused_token",
    };

    const result = await issueGroupCalendarFeedUseCase(deps, {
      groupId: testGroup.id,
      actorUserId: "usr_outsider",
      isStaff: false,
      now: NOW,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.NotVisible);
  });

  it("所属していない事務局には Forbidden を返す", async () => {
    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(null),
      }),
      groupCalendarFeedRepository: fakeGroupCalendarFeedRepository(),
      generateToken: () => "unused_token",
    };

    const result = await issueGroupCalendarFeedUseCase(deps, {
      groupId: testGroup.id,
      actorUserId: "usr_staff",
      isStaff: true,
      now: NOW,
    });

    expect(result.isErr()).toBe(true);
    const err = result._unsafeUnwrapErr();
    expect(err.code).toBe(GroupErrorCode.Forbidden);
    expect(err.userMessage).toBe("所属していない団体の購読 URL は発行できません。");
  });

  it("二度目の発行では既存のトークンがそのまま返る", async () => {
    const existingFeed: StoredGroupCalendarFeed = {
      id: "feed_existing",
      membershipId: memberMembership.id,
      token: "existing_token_original",
      createdAt: new Date("2026-04-01T00:00:00.000Z"),
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    };

    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(memberMembership),
      }),
      groupCalendarFeedRepository: fakeGroupCalendarFeedRepository({
        // 二度目の呼び出しに対して既存の行を返す
        issue: () => okAsync(existingFeed),
      }),
      generateToken: () => "newly_generated_token_ignored",
    };

    const result = await issueGroupCalendarFeedUseCase(deps, {
      groupId: testGroup.id,
      actorUserId: memberMembership.userId,
      isStaff: false,
      now: NOW,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().token).toBe("existing_token_original");
  });
});
