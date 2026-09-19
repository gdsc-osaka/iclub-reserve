import { describe, expect, it } from "vitest";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import type { UserGroupListItem } from "~/query/user/user-group-list";

import { toDashboardGroup } from "./dashboard-group";

const listItem = (roles: readonly MembershipRole[]): UserGroupListItem => ({
  id: "group-1",
  name: "テニス部",
  status: GroupStatus.Enabled,
  roles,
});

describe("toDashboardGroup", () => {
  it("管理者の役割を持っていれば isAdmin になる", () => {
    expect(toDashboardGroup(listItem([MembershipRole.Admin])).isAdmin).toBe(true);
  });

  it("管理者を兼ねていても isAdmin になる", () => {
    expect(toDashboardGroup(listItem([MembershipRole.Member, MembershipRole.Admin])).isAdmin).toBe(
      true,
    );
  });

  it("一般メンバーだけなら isAdmin にならない", () => {
    expect(toDashboardGroup(listItem([MembershipRole.Member])).isAdmin).toBe(false);
  });

  it("役割が無ければ isAdmin にならない", () => {
    expect(toDashboardGroup(listItem([])).isAdmin).toBe(false);
  });

  it("画面に出す項目をそのまま引き継ぐ", () => {
    expect(toDashboardGroup(listItem([MembershipRole.Member]))).toEqual({
      id: "group-1",
      name: "テニス部",
      status: GroupStatus.Enabled,
      isAdmin: false,
    });
  });
});
