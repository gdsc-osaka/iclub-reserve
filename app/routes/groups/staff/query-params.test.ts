import { describe, expect, it } from "vitest";

import { GroupStatus } from "~/domain/group";
import { parseStaffGroupParams, toDomainGroupStatus, toStaffGroupPath } from "./query-params";

describe("parseStaffGroupParams", () => {
  it("パラメータ未指定のときは既定の pending になる", () => {
    const params = parseStaffGroupParams(new URLSearchParams());
    expect(params.status).toBe("pending");
  });

  it.each(["pending", "enabled", "disabled", "all"] as const)(
    "有効なステータス (%s) をそのままパースする",
    (status) => {
      const params = parseStaffGroupParams(new URLSearchParams(`status=${status}`));
      expect(params.status).toBe(status);
    },
  );

  it.each(["", "unknown", "invalid", "PENDING", "123"])(
    "不正な値 (%s) は pending に倒す",
    (raw) => {
      const params = parseStaffGroupParams(new URLSearchParams(`status=${raw}`));
      expect(params.status).toBe("pending");
    },
  );
});

describe("toDomainGroupStatus", () => {
  it.each([
    { filter: "pending" as const, expected: GroupStatus.Pending },
    { filter: "enabled" as const, expected: GroupStatus.Enabled },
    { filter: "disabled" as const, expected: GroupStatus.Disabled },
    { filter: "all" as const, expected: null },
  ])("$filter を $expected にマッピングする", ({ filter, expected }) => {
    expect(toDomainGroupStatus(filter)).toBe(expected);
  });
});

describe("toStaffGroupPath", () => {
  it("既定の pending のときはクエリなしのパスを返す", () => {
    expect(toStaffGroupPath({ status: "pending" })).toBe("/staff/groups");
    expect(toStaffGroupPath({})).toBe("/staff/groups");
  });

  it.each(["enabled", "disabled", "all"] as const)(
    "%s のときは status クエリを付加する",
    (status) => {
      expect(toStaffGroupPath({ status })).toBe(`/staff/groups?status=${status}`);
    },
  );
});
