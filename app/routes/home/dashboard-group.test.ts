import { describe, expect, it } from "vitest";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import type { UserGroupListItem } from "~/query/user/user-group-list";

import { toDashboardGroup } from "./dashboard-group";

const listItem = (role: MembershipRole): UserGroupListItem => ({
  id: "group-1",
  name: "テニス部",
  status: GroupStatus.Enabled,
  role,
});

describe("toDashboardGroup", () => {
  it("管理者なら isAdmin になる", () => {
    expect(toDashboardGroup(listItem(MembershipRole.Admin)).isAdmin).toBe(true);
  });

  it("一般メンバーなら isAdmin にならない", () => {
    expect(toDashboardGroup(listItem(MembershipRole.Member)).isAdmin).toBe(false);
  });

  it("画面に出す項目をそのまま引き継ぐ", () => {
    expect(toDashboardGroup(listItem(MembershipRole.Member))).toEqual({
      id: "group-1",
      name: "テニス部",
      status: GroupStatus.Enabled,
      isAdmin: false,
    });
  });
});
