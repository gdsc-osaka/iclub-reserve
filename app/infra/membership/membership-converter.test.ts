import { describe, expect, it } from "vitest";

import { MembershipRole } from "~/domain/membership";
import { toMembershipRole } from "./membership-converter";

describe("toMembershipRole", () => {
  it.each([
    ["admin", MembershipRole.Admin],
    ["member", MembershipRole.Member],
    [" admin ", MembershipRole.Admin],
    [" member ", MembershipRole.Member],
    // 未知の役割は最小権限の Member に倒す
    ["owner", MembershipRole.Member],
    ["ADMIN", MembershipRole.Member],
    ["admin,member", MembershipRole.Member],
    ["", MembershipRole.Member],
    ["unknown", MembershipRole.Member],
  ])("%o を %o に変換する", (raw, expectedRole) => {
    expect(toMembershipRole(raw)).toBe(expectedRole);
  });
});
