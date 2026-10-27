import { describe, expect, it } from "vite-plus/test";

import { shouldRecountNavCounts, sumCounts } from "./nav-counts";

describe("shouldRecountNavCounts", () => {
  const baseUrl = "https://example.com";

  describe("フォーム送信後の判定（formMethod）", () => {
    it("POST などの更新送信後は、移動先が件数を持たない画面でも true を返す", () => {
      const currentUrl = new URL(`${baseUrl}/availability`);
      const nextUrl = new URL(`${baseUrl}/availability`);

      expect(shouldRecountNavCounts({ currentUrl, nextUrl, formMethod: "POST" })).toBe(true);
      expect(shouldRecountNavCounts({ currentUrl, nextUrl, formMethod: "post" })).toBe(true);
      expect(shouldRecountNavCounts({ currentUrl, nextUrl, formMethod: "DELETE" })).toBe(true);
      expect(shouldRecountNavCounts({ currentUrl, nextUrl, formMethod: "put" })).toBe(true);
    });

    it("GET 送信の場合は、フォーム送信という理由だけでは数え直さない", () => {
      const currentUrl = new URL(`${baseUrl}/availability?month=2026-10`);
      const nextUrl = new URL(`${baseUrl}/availability?month=2026-11`);

      expect(shouldRecountNavCounts({ currentUrl, nextUrl, formMethod: "GET" })).toBe(false);
      expect(shouldRecountNavCounts({ currentUrl, nextUrl, formMethod: "get" })).toBe(false);
    });
  });

  describe("件数を持つタブへの移動の判定（isCountedNavPath）", () => {
    it("ダッシュボード（/）を開いたときは true を返す", () => {
      const currentUrl = new URL(`${baseUrl}/availability`);
      const nextUrl = new URL(`${baseUrl}/`);

      expect(shouldRecountNavCounts({ currentUrl, nextUrl })).toBe(true);
    });

    it("事務局のダッシュボード（/staff）を開いたときは true を返す", () => {
      const currentUrl = new URL(`${baseUrl}/availability`);
      const nextUrl = new URL(`${baseUrl}/staff`);

      expect(shouldRecountNavCounts({ currentUrl, nextUrl })).toBe(true);
    });

    it("予約の承認（/staff/reservations）や検索条件つきの URL を開いたときは true を返す", () => {
      const currentUrl = new URL(`${baseUrl}/availability`);
      const nextUrl = new URL(`${baseUrl}/staff/reservations?status=provisional`);

      expect(shouldRecountNavCounts({ currentUrl, nextUrl })).toBe(true);
    });

    it("団体の管理（/staff/groups）を開いたときは true を返す", () => {
      const currentUrl = new URL(`${baseUrl}/reservations`);
      const nextUrl = new URL(`${baseUrl}/staff/groups`);

      expect(shouldRecountNavCounts({ currentUrl, nextUrl })).toBe(true);
    });

    it("件数を持たない画面への移動では false を返す", () => {
      const currentUrl = new URL(`${baseUrl}/`);
      const nextUrlAvailability = new URL(`${baseUrl}/availability`);
      const nextUrlReservationDetail = new URL(`${baseUrl}/reservations/res_123`);
      const nextUrlFacilities = new URL(`${baseUrl}/staff/facilities`);

      expect(shouldRecountNavCounts({ currentUrl, nextUrl: nextUrlAvailability })).toBe(false);
      expect(shouldRecountNavCounts({ currentUrl, nextUrl: nextUrlReservationDetail })).toBe(false);
      expect(shouldRecountNavCounts({ currentUrl, nextUrl: nextUrlFacilities })).toBe(false);
    });
  });

  describe("同じ URL の読み直しの判定（currentUrl.href === nextUrl.href）", () => {
    it("アカウント設定等の useRevalidator().revalidate() では true を返す", () => {
      // 件数を持たない /account 画面でも、氏名更新後の外枠情報更新のために loader を再実行する
      const currentUrl = new URL(`${baseUrl}/account`);
      const nextUrl = new URL(`${baseUrl}/account`);

      expect(shouldRecountNavCounts({ currentUrl, nextUrl })).toBe(true);
    });

    it("件数を持たない画面で検索条件だけが変わった場合は false を返す", () => {
      const currentUrl = new URL(`${baseUrl}/availability?date=2026-10-15`);
      const nextUrl = new URL(`${baseUrl}/availability?date=2026-10-16`);

      expect(shouldRecountNavCounts({ currentUrl, nextUrl })).toBe(false);
    });
  });
});

describe("sumCounts", () => {
  it("すべての内訳が読めた場合は合計値を返す", () => {
    expect(sumCounts([1, 2, 3])).toBe(6);
    expect(sumCounts([0, 0, 0])).toBe(0);
    expect(sumCounts([])).toBe(0);
  });

  it("1 つでも読めなかった内訳（null）がある場合は全体を null にする", () => {
    expect(sumCounts([1, null, 3])).toBe(null);
    expect(sumCounts([null])).toBe(null);
    expect(sumCounts([null, 0])).toBe(null);
  });
});
