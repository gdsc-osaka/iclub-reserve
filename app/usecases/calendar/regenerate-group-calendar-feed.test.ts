import { okAsync } from "neverthrow";
import { describe, expect, it } from "vite-plus/test";

import type { StoredGroupCalendarFeed } from "~/domain/calendar";
import { GroupErrorCode, GroupStatus, type Group } from "~/domain/group";
import { MembershipRole, type StoredMembership } from "~/domain/membership";
import { fakeGroupCalendarFeedRepository } from "~/testing/fakes/calendar";
import { fakeGroupRepository } from "~/testing/fakes/group";
import { fakeMembershipRepository } from "~/testing/fakes/membership";
import { regenerateGroupCalendarFeedUseCase } from "./regenerate-group-calendar-feed";

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

describe("regenerateGroupCalendarFeedUseCase", () => {
  it("メンバーが作り直すと新しいトークンに置き換わる", async () => {
    let regeneratedFeed: StoredGroupCalendarFeed | undefined;

    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(memberMembership),
      }),
      groupCalendarFeedRepository: fakeGroupCalendarFeedRepository({
        regenerate: (input) => {
          regeneratedFeed = {
            id: "feed_1",
            membershipId: input.membershipId,
            token: input.token,
            createdAt: new Date("2026-04-01T00:00:00.000Z"),
            updatedAt: input.now,
          };
          return okAsync(regeneratedFeed);
        },
      }),
      generateToken: () => "new_regenerated_token_999",
    };

    const result = await regenerateGroupCalendarFeedUseCase(deps, {
      groupId: testGroup.id,
      actorUserId: memberMembership.userId,
      isStaff: false,
      now: NOW,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().token).toBe("new_regenerated_token_999");
    expect(regeneratedFeed?.token).toBe("new_regenerated_token_999");
  });

  it("管理者も作り直せる（役割を問わない）", async () => {
    const deps = {
      groupRepository: fakeGroupRepository({
        findById: () => okAsync(testGroup),
      }),
      membershipRepository: fakeMembershipRepository({
        findByGroupAndUser: () => okAsync(adminMembership),
      }),
      groupCalendarFeedRepository: fakeGroupCalendarFeedRepository({
        regenerate: (input) =>
          okAsync({
            id: "feed_admin",
            membershipId: input.membershipId,
            token: input.token,
            createdAt: new Date(),
            updatedAt: input.now,
          }),
      }),
      generateToken: () => "admin_regenerated_token_777",
    };

    const result = await regenerateGroupCalendarFeedUseCase(deps, {
      groupId: testGroup.id,
      actorUserId: adminMembership.userId,
      isStaff: false,
      now: NOW,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().token).toBe("admin_regenerated_token_777");
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
      generateToken: () => "unused",
    };

    const result = await regenerateGroupCalendarFeedUseCase(deps, {
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
      generateToken: () => "unused",
    };

    const result = await regenerateGroupCalendarFeedUseCase(deps, {
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
});
