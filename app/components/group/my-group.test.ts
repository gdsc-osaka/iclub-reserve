import { describe, expect, it } from "vitest";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import type { UserGroupListItem } from "~/query/user/user-group-list";

import { toMyGroup } from "./my-group";

const listItem = (role: MembershipRole, memberCount = 3): UserGroupListItem => ({
  id: "group-1",
  name: "テニス部",
  status: GroupStatus.Enabled,
  role,
  memberCount,
});

describe("toMyGroup", () => {
  it("管理者なら isAdmin になる", () => {
    expect(toMyGroup(listItem(MembershipRole.Admin)).isAdmin).toBe(true);
  });

  it("一般メンバーなら isAdmin にならない", () => {
    expect(toMyGroup(listItem(MembershipRole.Member)).isAdmin).toBe(false);
  });

  it("画面に出す項目（メンバー数含む）をそのまま引き継ぐ", () => {
    expect(toMyGroup(listItem(MembershipRole.Member, 5))).toEqual({
      id: "group-1",
      name: "テニス部",
      status: GroupStatus.Enabled,
      isAdmin: false,
      memberCount: 5,
    });
  });
});
