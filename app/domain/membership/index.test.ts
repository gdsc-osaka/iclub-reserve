import { describe, expect, it } from "vitest";

import type { PermissionTable } from "../authz";
import {
  actorRoles,
  canAct,
  canPerform,
  isMembershipRole,
  MembershipRole,
  StaffRole,
  type Actor,
  type Membership,
} from ".";

/**
 * canAct の検証用に用意した表。
 *
 * 実際の権限表を使うと、ここの検証がグループの権限の中身に引きずられる。
 * このファイルで確かめたいのは「操作する人を表にどう当てるか」だけなので、
 * 中身が変わらない表を自前で用意する。
 */
const TestAction = {
  /** 役割を問わず全員に許す操作 */
  Public: "public",
  Harmless: "harmless",
  Privileged: "privileged",
  /** 事務局にだけ許す操作 */
  StaffOnly: "staff_only",
} as const;
type TestAction = (typeof TestAction)[keyof typeof TestAction];

const table: PermissionTable<MembershipRole | typeof StaffRole, TestAction> = {
  base: [TestAction.Public],
  byRole: {
    [MembershipRole.Admin]: [TestAction.Harmless, TestAction.Privileged],
    [MembershipRole.Member]: [TestAction.Harmless],
    [StaffRole]: [TestAction.StaffOnly],
  },
};

const membershipOf = (role: MembershipRole): Membership => ({
  groupId: "grp_test",
  userId: "usr_test",
  role,
});

describe("actorRoles", () => {
  it("事務局でも所属でもなければ役割を 1 つも持たない", () => {
    expect(actorRoles({ isStaff: false, membership: null })).toEqual([]);
  });

  it("所属していれば、その団体での役割を持つ", () => {
    expect(actorRoles({ isStaff: false, membership: membershipOf(MembershipRole.Member) })).toEqual(
      [MembershipRole.Member],
    );
  });

  it("事務局で所属していなければ、事務局の役割だけを持つ", () => {
    expect(actorRoles({ isStaff: true, membership: null })).toEqual([StaffRole]);
  });

  it("事務局でありながら所属もしていれば、両方の役割を持つ", () => {
    // どちらか一方に畳むと、畳んだ側の権限が消える
    expect(actorRoles({ isStaff: true, membership: membershipOf(MembershipRole.Member) })).toEqual([
      StaffRole,
      MembershipRole.Member,
    ]);
  });
});

/** 操作する人の形。COND-007 により、団体での役割は同時に 1 つだけ */
const actors = {
  所属なし: { isStaff: false, membership: null },
  メンバー: { isStaff: false, membership: membershipOf(MembershipRole.Member) },
  管理者: { isStaff: false, membership: membershipOf(MembershipRole.Admin) },
  事務局: { isStaff: true, membership: null },
  事務局かつメンバー: { isStaff: true, membership: membershipOf(MembershipRole.Member) },
  事務局かつ管理者: { isStaff: true, membership: membershipOf(MembershipRole.Admin) },
} as const satisfies Record<string, Actor>;
type ActorName = keyof typeof actors;

const expected: Record<ActorName, Record<TestAction, boolean>> = {
  所属なし: {
    [TestAction.Public]: true,
    [TestAction.Harmless]: false,
    [TestAction.Privileged]: false,
    [TestAction.StaffOnly]: false,
  },
  メンバー: {
    [TestAction.Public]: true,
    [TestAction.Harmless]: true,
    [TestAction.Privileged]: false,
    [TestAction.StaffOnly]: false,
  },
  管理者: {
    [TestAction.Public]: true,
    [TestAction.Harmless]: true,
    [TestAction.Privileged]: true,
    [TestAction.StaffOnly]: false,
  },
  事務局: {
    [TestAction.Public]: true,
    [TestAction.Harmless]: false,
    [TestAction.Privileged]: false,
    [TestAction.StaffOnly]: true,
  },
  // 事務局の権限と、団体での役割の権限の両方を持つ
  事務局かつメンバー: {
    [TestAction.Public]: true,
    [TestAction.Harmless]: true,
    [TestAction.Privileged]: false,
    [TestAction.StaffOnly]: true,
  },
  事務局かつ管理者: {
    [TestAction.Public]: true,
    [TestAction.Harmless]: true,
    [TestAction.Privileged]: true,
    [TestAction.StaffOnly]: true,
  },
};

const combinations = (Object.keys(actors) as readonly ActorName[]).flatMap((name) =>
  Object.values(TestAction).map((action) => [name, action] as const),
);

describe("canAct", () => {
  it.each(combinations)("%s は %s を許可されているか判定できる", (name, action) => {
    expect(canAct(table, actors[name], action)).toBe(expected[name][action]);
  });
});

describe("canPerform", () => {
  it.each(Object.values(TestAction))(
    "所属していなければ、役割の上乗せ分の %s は許可されない",
    (action) => {
      // 認可の要。ここが base どまりでなくなると、所属していないグループを操作できてしまう
      expect(canPerform(table, null, action)).toBe(expected["所属なし"][action]);
    },
  );

  it("所属していれば役割どおりに判定される", () => {
    expect(canPerform(table, membershipOf(MembershipRole.Admin), TestAction.Privileged)).toBe(true);
    expect(canPerform(table, membershipOf(MembershipRole.Member), TestAction.Privileged)).toBe(
      false,
    );
    expect(canPerform(table, membershipOf(MembershipRole.Member), TestAction.Harmless)).toBe(true);
  });

  it("事務局の権限は見ない（canAct へ移行するまでの窓口であるため）", () => {
    expect(canPerform(table, membershipOf(MembershipRole.Admin), TestAction.StaffOnly)).toBe(false);
  });
});

describe("isMembershipRole", () => {
  it.each(Object.values(MembershipRole))("%o はこのアプリの役割として認める", (role) => {
    expect(isMembershipRole(role)).toBe(true);
  });

  it.each([
    // このアプリで定義されていない未知の役割文字列（例: "owner"）は弾く
    "owner",
    // 事務局は保存される役割ではない。ここを通ると団体の管理者が事務局を作れてしまう
    StaffRole,
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
