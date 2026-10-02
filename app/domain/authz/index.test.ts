import { describe, expect, it } from "vitest";

import { rolesCan, type PermissionTable } from ".";

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
  /** 役割を問わず全員に許す操作。base の検証に使う */
  Browse: "browse",
  Read: "read",
  Write: "write",
  /** どの役割にも許可しない操作。表に現れない操作を渡せることの確認に使う */
  Publish: "publish",
} as const;
type Action = (typeof Action)[keyof typeof Action];

/**
 * 役割ごとに許す操作をあえて重ねていない。
 *
 * 片方がもう片方を含んでいると、2 つの役割を同時に持つ人の判定が
 * 和集合になっているのか、強い方だけを見ているのかを区別できない。
 */
const table: PermissionTable<Role, Action> = {
  base: [Action.Browse],
  byRole: {
    [Role.Reader]: [Action.Read],
    [Role.Writer]: [Action.Write],
  },
};

/** 検証する役割の組み合わせ。1 人が複数の役割を同時に持つことがある */
const roleSets = {
  なし: [],
  reader: [Role.Reader],
  writer: [Role.Writer],
  "reader と writer": [Role.Reader, Role.Writer],
} as const satisfies Record<string, readonly Role[]>;
type RoleSetName = keyof typeof roleSets;

const expected: Record<RoleSetName, Record<Action, boolean>> = {
  なし: {
    [Action.Browse]: true,
    [Action.Read]: false,
    [Action.Write]: false,
    [Action.Publish]: false,
  },
  reader: {
    [Action.Browse]: true,
    [Action.Read]: true,
    [Action.Write]: false,
    [Action.Publish]: false,
  },
  writer: {
    [Action.Browse]: true,
    [Action.Read]: false,
    [Action.Write]: true,
    [Action.Publish]: false,
  },
  "reader と writer": {
    [Action.Browse]: true,
    [Action.Read]: true,
    [Action.Write]: true,
    [Action.Publish]: false,
  },
};

/** 役割の組み合わせと操作のすべての組み合わせ。個別に it を並べると操作を足したとき漏れる */
const combinations = (Object.keys(roleSets) as readonly RoleSetName[]).flatMap((name) =>
  Object.values(Action).map((action) => [name, action] as const),
);

describe("rolesCan", () => {
  it.each(combinations)("役割が %s のとき %s を許可されているか判定できる", (name, action) => {
    expect(rolesCan(table, roleSets[name], action)).toBe(expected[name][action]);
  });

  it.each(Object.values(Action))("表に無い役割は %s の判定に影響しない", (action) => {
    // 表に無い役割で許可が増えると、表のキーの書き間違いが権限の穴になる
    expect(rolesCan(table, ["owner"], action)).toBe(expected["なし"][action]);
  });

  it.each(["constructor", "toString", "__proto__"])(
    "Object の持ち物の名前 %o を役割として渡しても許可されない",
    (role) => {
      expect(rolesCan(table, [role], Action.Write)).toBe(false);
    },
  );

  it("同じ役割を重ねて渡しても結果は変わらない", () => {
    expect(rolesCan(table, [Role.Reader, Role.Reader], Action.Read)).toBe(true);
    expect(rolesCan(table, [Role.Reader, Role.Reader], Action.Write)).toBe(false);
  });
});
