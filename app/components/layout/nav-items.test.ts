import { describe, expect, it } from "vitest";

import {
  commonNavItems,
  formatNavCount,
  isCountedNavPath,
  staffNavItems,
  toNavCount,
  toNavItems,
  type NavCounts,
  type NavItem,
} from "./nav-items";

const navItem = (id: string): NavItem => {
  const item = [...commonNavItems, ...staffNavItems].find((navItem) => navItem.id === id);
  if (item === undefined) throw new Error(`ナビ項目 ${id} がありません`);
  return item;
};

describe("isCountedNavPath", () => {
  it("ダッシュボード（/）は完全一致でのみ true を返す", () => {
    // "/" は件数を持つタブ
    expect(isCountedNavPath("/")).toBe(true);
    // "/" から始まる他の画面はダッシュボードではないため false
    expect(isCountedNavPath("/availability")).toBe(false);
    expect(isCountedNavPath("/reservations")).toBe(false);
    expect(isCountedNavPath("/account")).toBe(false);
  });

  it("予約の承認（/staff/reservations）とその配下の画面で true を返す", () => {
    expect(isCountedNavPath("/staff/reservations")).toBe(true);
    expect(isCountedNavPath("/staff/reservations/res_123")).toBe(true);
  });

  it("団体の管理（/staff/groups）とその配下の画面で true を返す", () => {
    expect(isCountedNavPath("/staff/groups")).toBe(true);
    expect(isCountedNavPath("/staff/groups/grp_123")).toBe(true);
  });

  it("件数を持たない事務局画面では false を返す", () => {
    expect(isCountedNavPath("/staff/facilities")).toBe(false);
    expect(isCountedNavPath("/staff/calendars")).toBe(false);
    expect(isCountedNavPath("/staff/audit-log")).toBe(false);
    expect(isCountedNavPath("/staff/staff-members")).toBe(false);
  });
});

describe("formatNavCount", () => {
  it("99 までは数字をそのまま文字列にして返す", () => {
    expect(formatNavCount(0)).toBe("0");
    expect(formatNavCount(1)).toBe("1");
    expect(formatNavCount(99)).toBe("99");
  });

  it("100 以上はバッジの枠崩れを防ぐため 99+ を返す", () => {
    expect(formatNavCount(100)).toBe("99+");
    expect(formatNavCount(101)).toBe("99+");
    expect(formatNavCount(999)).toBe("99+");
  });
});

describe("toNavCount", () => {
  const counts: NavCounts = { dashboard: 0, "staff-approvals": 3, "staff-groups": null };

  it("件数を持つ項目は、1 件以上ならその数を返す", () => {
    expect(toNavCount(counts, navItem("staff-approvals"))).toBe(3);
  });

  it("0 件と、数えなかった・数えられなかった（null）項目は undefined を返す", () => {
    expect(toNavCount(counts, navItem("dashboard"))).toBeUndefined();
    expect(toNavCount(counts, navItem("staff-groups"))).toBeUndefined();
  });

  it("件数を持たない項目は undefined を返す", () => {
    expect(toNavCount(counts, navItem("availability"))).toBeUndefined();
    expect(toNavCount(counts, navItem("staff-facilities"))).toBeUndefined();
    expect(toNavCount(counts, navItem("staff-calendars"))).toBeUndefined();
  });
});

describe("toNavItems", () => {
  it("一般ユーザーにはカレンダー購読項目が出ない", () => {
    const items = toNavItems(false);
    expect(items.some((item) => item.id === "calendars" || item.id === "staff-calendars")).toBe(
      false,
    );
  });

  it("事務局には /staff/calendars のカレンダー購読項目が出る", () => {
    const items = toNavItems(true);
    const calendarItem = items.find((item) => item.id === "staff-calendars");
    expect(calendarItem).toBeDefined();
    expect(calendarItem?.to).toBe("/staff/calendars");
  });
});
