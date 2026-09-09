import { describe, expect, it } from "vitest";

import { MembershipRole } from "~/domain/membership";
import { toMembershipRoles } from "./membership-converter";

describe("toMembershipRoles", () => {
  it.each([
    ["admin", [MembershipRole.Admin]],
    ["member", [MembershipRole.Member]],
    // カンマ区切りは Better Auth が複数の役割を 1 列に持つときの形式
    ["admin,member", [MembershipRole.Admin, MembershipRole.Member]],
    ["admin, member", [MembershipRole.Admin, MembershipRole.Member]],
    [" admin ", [MembershipRole.Admin]],
    // 知らない役割は捨て、残りだけを採用する
    ["member,unknown", [MembershipRole.Member]],
    // 1 つも残らなければ最小権限の Member として扱う
    ["owner", [MembershipRole.Member]],
    ["ADMIN", [MembershipRole.Member]],
    ["", [MembershipRole.Member]],
  ])("%o を %o に変換する", (raw, roles) => {
    expect(toMembershipRoles(raw)).toEqual(roles);
  });
});
