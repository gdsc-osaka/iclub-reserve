import { describe, expect, it } from "vite-plus/test";

import { AppArea } from "./app-area";
import {
  formatNavCount,
  hasAnyNavCount,
  isCountedNavPath,
  isNavItemActive,
  staffNavItems,
  toBottomNavItems,
  toNavCount,
  toNavItems,
  toNewReservationLabel,
  toOverflowNavItems,
  userNavItems,
  type NavCounts,
  type NavItem,
} from "./nav-items";

const navItem = (id: string): NavItem => {
  const item = [...userNavItems, ...staffNavItems].find((item) => item.id === id);
  if (item === undefined) throw new Error(`ナビ項目 ${id} がありません`);
  return item;
};

describe("isCountedNavPath", () => {
  it("利用者のダッシュボード（/）は完全一致でのみ true を返す", () => {
    // "/" は件数を持つタブ
    expect(isCountedNavPath("/")).toBe(true);
    // "/" から始まる他の画面はダッシュボードではないため false
    expect(isCountedNavPath("/availability")).toBe(false);
    expect(isCountedNavPath("/reservations")).toBe(false);
    expect(isCountedNavPath("/account")).toBe(false);
  });

  it("事務局のダッシュボード（/staff）は完全一致でのみ true を返す", () => {
    expect(isCountedNavPath("/staff")).toBe(true);
    expect(isCountedNavPath("/staff/facilities")).toBe(false);
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

describe("isNavItemActive", () => {
  const staffDashboard = navItem("staff-dashboard");
  const staffApprovals = navItem("staff-approvals");
  const userDashboard = navItem("dashboard");
  const userReservations = navItem("reservations");

  it("/staff では事務局のダッシュボードだけが選択中になり、他の画面では選択中にならない", () => {
    expect(isNavItemActive(staffDashboard, "/staff")).toBe(true);
    expect(isNavItemActive(staffDashboard, "/staff/reservations")).toBe(false);
    expect(isNavItemActive(staffDashboard, "/staff/facilities")).toBe(false);
  });

  it("/staff/reservations では予約の承認が選択中になり、配下の画面でも選択中になる", () => {
    expect(isNavItemActive(staffApprovals, "/staff/reservations")).toBe(true);
    expect(isNavItemActive(staffApprovals, "/staff/reservations/res_123")).toBe(true);
    expect(isNavItemActive(staffApprovals, "/staff")).toBe(false);
  });

  it("/ では利用者のダッシュボードだけが選択中になる", () => {
    expect(isNavItemActive(userDashboard, "/")).toBe(true);
    expect(isNavItemActive(userDashboard, "/reservations")).toBe(false);
  });

  it("/reservations では予約一覧とその配下の画面が選択中になる", () => {
    expect(isNavItemActive(userReservations, "/reservations")).toBe(true);
    expect(isNavItemActive(userReservations, "/reservations/res_123")).toBe(true);
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
  const counts: NavCounts = {
    dashboard: 0,
    "staff-dashboard": 2,
    "staff-approvals": 3,
    "staff-groups": null,
  };

  it("件数を持つ項目は、1 件以上ならその数を返す", () => {
    expect(toNavCount(counts, navItem("staff-approvals"))).toBe(3);
    expect(toNavCount(counts, navItem("staff-dashboard"))).toBe(2);
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

describe("hasAnyNavCount", () => {
  it("指定した項目のいずれかに 1 件以上の件数があれば true を返す", () => {
    const counts: NavCounts = {
      dashboard: 0,
      "staff-dashboard": 0,
      "staff-approvals": 1,
      "staff-groups": null,
    };
    expect(hasAnyNavCount(counts, staffNavItems)).toBe(true);
  });

  it("すべての項目の件数が 0 または null、あるいは件数を持たない項目のみなら false を返す", () => {
    const counts: NavCounts = {
      dashboard: 0,
      "staff-dashboard": 0,
      "staff-approvals": null,
      "staff-groups": null,
    };
    expect(hasAnyNavCount(counts, userNavItems)).toBe(false);
    expect(hasAnyNavCount(counts, staffNavItems)).toBe(false);
  });
});

describe("toNavItems", () => {
  it("利用者の画面にはカレンダー購読や予約の承認が出ない", () => {
    const items = toNavItems(AppArea.User);
    expect(items.some((item) => item.id === "staff-calendars")).toBe(false);
    expect(items.some((item) => item.id === "staff-approvals")).toBe(false);
  });

  it("利用者の画面には所属団体と予約が出る", () => {
    const items = toNavItems(AppArea.User);
    expect(items.some((item) => item.id === "groups")).toBe(true);
    expect(items.some((item) => item.id === "reservations")).toBe(true);
  });

  it("事務局の画面には所属団体と予約が無く、予約の承認やカレンダー購読が出る", () => {
    const items = toNavItems(AppArea.Staff);
    expect(items.some((item) => item.id === "groups")).toBe(false);
    expect(items.some((item) => item.id === "reservations")).toBe(false);
    expect(items.some((item) => item.id === "staff-approvals")).toBe(true);
    expect(items.some((item) => item.id === "staff-calendars")).toBe(true);
  });
});

describe("toNewReservationLabel", () => {
  it("事務局には「予約を作成」を返す", () => {
    expect(toNewReservationLabel(AppArea.Staff)).toBe("予約を作成");
  });

  it("利用者には「予約を申請」を返す", () => {
    expect(toNewReservationLabel(AppArea.User)).toBe("予約を申請");
  });
});

describe("ボトムバーの項目配置", () => {
  it("利用者のボトムバーは 3 項目で、ダッシュボード・空き状況・予約が並ぶ", () => {
    expect(toBottomNavItems(AppArea.User).map((item) => item.id)).toEqual([
      "dashboard",
      "availability",
      "reservations",
    ]);
  });

  it("事務局のボトムバーは 3 項目で、ダッシュボード・空き状況・予約の承認が並ぶ", () => {
    expect(toBottomNavItems(AppArea.Staff).map((item) => item.id)).toEqual([
      "staff-dashboard",
      "availability",
      "staff-approvals",
    ]);
  });

  it("利用者の「その他」には「所属団体」が含まれる", () => {
    expect(toOverflowNavItems(AppArea.User).map((item) => item.id)).toContain("groups");
  });

  it("事務局の「その他」には「施設・設備の管理」が含まれ、「予約」は含まれない", () => {
    const overflowIds = toOverflowNavItems(AppArea.Staff).map((item) => item.id);
    expect(overflowIds).toContain("staff-facilities");
    expect(overflowIds).not.toContain("reservations");
  });
});
