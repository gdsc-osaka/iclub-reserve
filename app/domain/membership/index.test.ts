import { describe, expect, it } from "vitest";

import type { PermissionTable } from "../authz";
import { canPerform, isMembershipRole, MembershipRole, type Membership } from ".";

/**
 * canPerform の検証用に用意した表。
 *
 * 実際の権限表を使うと、ここの検証がグループの権限の中身に引きずられる。
 * このファイルで確かめたいのは「Membership を表にどう当てるか」だけなので、
 * 中身が変わらない表を自前で用意する。
 */
const TestAction = {
  Harmless: "harmless",
  Privileged: "privileged",
} as const;
type TestAction = (typeof TestAction)[keyof typeof TestAction];

const table: PermissionTable<MembershipRole, TestAction> = {
  [MembershipRole.Admin]: [TestAction.Harmless, TestAction.Privileged],
  [MembershipRole.Member]: [TestAction.Harmless],
};

const membershipOf = (role: MembershipRole): Membership => ({
  groupId: "grp_test",
  userId: "usr_test",
  role,
});

describe("canPerform", () => {
  it.each(Object.values(TestAction))("所属していなければ %s は許可されない", (action) => {
    // 認可の要。ここが false でなくなると、所属していないグループを操作できてしまう
    expect(canPerform(table, null, action)).toBe(false);
  });

  it("所属していれば役割どおりに判定される", () => {
    expect(canPerform(table, membershipOf(MembershipRole.Admin), TestAction.Privileged)).toBe(true);
    expect(canPerform(table, membershipOf(MembershipRole.Member), TestAction.Privileged)).toBe(
      false,
    );
    expect(canPerform(table, membershipOf(MembershipRole.Member), TestAction.Harmless)).toBe(true);
  });
});

describe("isMembershipRole", () => {
  it.each(Object.values(MembershipRole))("%o はこのアプリの役割として認める", (role) => {
    expect(isMembershipRole(role)).toBe(true);
  });

  it.each([
    // このアプリで定義されていない未知の役割文字列（例: "owner"）は弾く
    "owner",
    // 大文字小文字は区別する。DB には小文字しか入らない
    "Admin",
    "ADMIN",
    // カンマ区切りの文字列は弾く
    "admin,member",
    "",
    " admin",
  ])("%o は役割として認めない", (value) => {
    expect(isMembershipRole(value)).toBe(false);
  });
});
