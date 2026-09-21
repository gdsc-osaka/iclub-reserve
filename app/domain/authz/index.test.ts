import { describe, expect, it } from "vitest";

import { roleCan, type PermissionTable } from ".";

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
