import { describe, expect, it } from "vitest";

import { roleCan, rolesCan, type PermissionTable } from ".";

/**
 * 仕組みだけを検証したいので、実在する役割や操作は使わない。
 * 実際の権限表の中身は各ドメインのテストが検証する。
 */
const Role = {
  Reader: "reader",
  Writer: "writer",
} as const;
type Role = (typeof Role)[keyof typeof Role];

const Action = {
  Read: "read",
  Write: "write",
  /** どの役割にも許可しない操作。表に現れない操作を渡せることの確認に使う */
  Publish: "publish",
} as const;
type Action = (typeof Action)[keyof typeof Action];

const table: PermissionTable<Role, Action> = {
  [Role.Reader]: [Action.Read],
  [Role.Writer]: [Action.Read, Action.Write],
};

const expected: Record<Role, Record<Action, boolean>> = {
  [Role.Reader]: {
    [Action.Read]: true,
    [Action.Write]: false,
    [Action.Publish]: false,
  },
  [Role.Writer]: {
    [Action.Read]: true,
    [Action.Write]: true,
    [Action.Publish]: false,
  },
};

/** 役割と操作のすべての組み合わせ。個別に it を並べると操作を足したとき漏れる */
const combinations = Object.values(Role).flatMap((role) =>
  Object.values(Action).map((action) => [role, action] as const),
);

describe("roleCan", () => {
  it.each(combinations)("%s は %s を許可されているか判定できる", (role, action) => {
    expect(roleCan(table, role, action)).toBe(expected[role][action]);
  });
});

describe("rolesCan", () => {
  it.each(combinations)("役割が %s 1 つだけなら %s の判定は roleCan と一致する", (role, action) => {
    expect(rolesCan(table, [role], action)).toBe(expected[role][action]);
  });

  it("いずれか 1 つの役割が許可していれば許可する", () => {
    // Better Auth の hasPermissionFn と同じ判定方法。片方だけ見て判定すると、
    // 自前の判定では拒否なのに Better Auth の API では通る、という逆転が起きる
    expect(rolesCan(table, [Role.Reader, Role.Writer], Action.Write)).toBe(true);
    expect(rolesCan(table, [Role.Writer, Role.Reader], Action.Write)).toBe(true);
  });

  it("役割を 1 つも持たなければ何も許可しない", () => {
    expect(rolesCan(table, [], Action.Read)).toBe(false);
  });

  it.each(Object.values(Role))("どの役割にも許可していない操作は %s でも拒否する", (role) => {
    expect(rolesCan(table, [role], Action.Publish)).toBe(false);
  });
});
