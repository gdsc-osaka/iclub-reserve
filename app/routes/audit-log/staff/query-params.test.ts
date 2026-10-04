import { describe, expect, it } from "vitest";

import { AuditLogTargetType } from "~/domain/audit-log";
import { parseTokyoDateKey } from "~/lib/date";
import { parseAuditLogSearchParams, toAuditLogSearchPath } from "./query-params";

describe("parseAuditLogSearchParams", () => {
  it("空のパラメータに対して既定値を返す", () => {
    const params = new URLSearchParams();
    const parsed = parseAuditLogSearchParams(params);

    expect(parsed.type).toBeNull();
    expect(parsed.group).toBeNull();
    expect(parsed.actor).toBeNull();
    expect(parsed.from).toBeNull();
    expect(parsed.to).toBeNull();
    expect(parsed.page).toBe(1);
    expect(parsed.filter).toEqual({
      targetType: null,
      groupId: null,
      actorId: null,
      occurredFrom: null,
      occurredBefore: null,
    });
  });

  it("正常なパラメータを正しくパースする", () => {
    const params = new URLSearchParams({
      type: "reservation",
      group: "grp_123",
      actor: "usr_456",
      from: "2026-05-10",
      to: "2026-05-20",
      page: "3",
    });
    const parsed = parseAuditLogSearchParams(params);

    expect(parsed.type).toBe(AuditLogTargetType.Reservation);
    expect(parsed.group).toBe("grp_123");
    expect(parsed.actor).toBe("usr_456");
    expect(parsed.from).toBe("2026-05-10");
    expect(parsed.to).toBe("2026-05-20");
    expect(parsed.page).toBe(3);

    // from は 2026-05-10 00:00:00 JST
    expect(parsed.filter.occurredFrom).toEqual(parseTokyoDateKey("2026-05-10"));
    // to はその日を含むため、2026-05-21 00:00:00 JST（翌日の 0 時）より前
    expect(parsed.filter.occurredBefore).toEqual(parseTokyoDateKey("2026-05-21"));
  });

  it("不正な値や壊れた値が与えられた場合に既定値へ安全にフォールバックする", () => {
    const params = new URLSearchParams({
      type: "invalid_type",
      group: "   ",
      actor: "",
      from: "invalid-date",
      to: "2026-02-31", // 存在しない日付
      page: "-1",
    });
    const parsed = parseAuditLogSearchParams(params);

    expect(parsed.type).toBeNull();
    expect(parsed.group).toBeNull();
    expect(parsed.actor).toBeNull();
    expect(parsed.from).toBeNull();
    expect(parsed.to).toBeNull();
    expect(parsed.page).toBe(1);
  });

  it("選択欄の「すべて」（all）は絞り込まないものとして扱う", () => {
    const parsed = parseAuditLogSearchParams(
      new URLSearchParams({ type: "all", group: "all", actor: "all", from: "", to: "" }),
    );

    expect(parsed.filter).toEqual({
      targetType: null,
      groupId: null,
      actorId: null,
      occurredFrom: null,
      occurredBefore: null,
    });
    expect(toAuditLogSearchPath(parsed)).toBe("/staff/audit-log");
  });

  it("page に非整数や NaN が渡された場合は 1 にフォールバックする", () => {
    expect(parseAuditLogSearchParams(new URLSearchParams({ page: "abc" })).page).toBe(1);
    expect(parseAuditLogSearchParams(new URLSearchParams({ page: "0" })).page).toBe(1);
  });
});

describe("toAuditLogSearchPath", () => {
  it("パラメータが無い・既定値のみの場合はベースパスを返す", () => {
    expect(toAuditLogSearchPath({})).toBe("/staff/audit-log");
    expect(toAuditLogSearchPath({ page: 1, type: null, group: null })).toBe("/staff/audit-log");
  });

  it("指定されたパラメータをクエリ文字列に含め、往復で一致する", () => {
    const original = {
      type: AuditLogTargetType.Group,
      group: "grp_robotics",
      actor: "usr_staff",
      from: "2026-06-01",
      to: "2026-06-30",
      page: 2,
    };

    const path = toAuditLogSearchPath(original);
    const searchParams = new URL(path, "http://localhost").searchParams;
    const roundTrip = parseAuditLogSearchParams(searchParams);

    expect(roundTrip.type).toBe(original.type);
    expect(roundTrip.group).toBe(original.group);
    expect(roundTrip.actor).toBe(original.actor);
    expect(roundTrip.from).toBe(original.from);
    expect(roundTrip.to).toBe(original.to);
    expect(roundTrip.page).toBe(original.page);
  });
});
