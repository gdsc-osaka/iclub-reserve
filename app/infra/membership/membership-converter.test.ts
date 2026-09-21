import { describe, expect, it } from "vitest";

import { MembershipRole } from "~/domain/membership";
import { countAdminUsers, toMembershipRoles } from "./membership-converter";

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

describe("countAdminUsers", () => {
  it("管理者の行だけを数える", () => {
    const count = countAdminUsers([
      { userId: "u1", role: "admin" },
      { userId: "u2", role: "member" },
      { userId: "u3", role: "admin" },
    ]);

    expect(count).toBe(2);
  });

  it("カンマ区切りで管理者を含む行も管理者として数える", () => {
    const count = countAdminUsers([
      { userId: "u1", role: "admin,member" },
      { userId: "u2", role: "member" },
    ]);

    expect(count).toBe(1);
  });

  it("同じユーザーの行が重複していても 1 人として数える", () => {
    // 役割の更新・削除は同じ (団体, ユーザー) の行をまとめて変更するため、
    // ここで 2 人と数えてしまうと最後の管理者の保護をすり抜ける
    const count = countAdminUsers([
      { userId: "u1", role: "admin" },
      { userId: "u1", role: "admin" },
    ]);

    expect(count).toBe(1);
  });

  it("知らない役割しか持たない行は管理者として数えない", () => {
    const count = countAdminUsers([
      { userId: "u1", role: "owner" },
      { userId: "u2", role: "" },
    ]);

    expect(count).toBe(0);
  });

  it("行が 1 つも無ければ 0 を返す", () => {
    expect(countAdminUsers([])).toBe(0);
  });
});
