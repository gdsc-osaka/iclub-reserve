import { describe, expect, it } from "vitest";

import { parseHistoryPage } from "./query-params";

describe("parseHistoryPage", () => {
  it("指定がない場合は 1 を返す", () => {
    expect(parseHistoryPage("")).toBe(1);
    expect(parseHistoryPage(new URLSearchParams())).toBe(1);
    expect(parseHistoryPage(new Request("https://example.com/groups/grp_1"))).toBe(1);
  });

  it("1 以上の整数の場合はその値を返す", () => {
    expect(parseHistoryPage("historyPage=1")).toBe(1);
    expect(parseHistoryPage("historyPage=2")).toBe(2);
    expect(parseHistoryPage("historyPage=10")).toBe(10);
    expect(parseHistoryPage(new URLSearchParams({ historyPage: "5" }))).toBe(5);
    expect(parseHistoryPage(new Request("https://example.com/groups/grp_1?historyPage=3"))).toBe(3);
  });

  it("0 以下の値は 1 にフォールバックする", () => {
    expect(parseHistoryPage("historyPage=0")).toBe(1);
    expect(parseHistoryPage("historyPage=-1")).toBe(1);
    expect(parseHistoryPage("historyPage=-10")).toBe(1);
  });

  it("小数や非数、空文字は 1 にフォールバックする", () => {
    expect(parseHistoryPage("historyPage=1.5")).toBe(1);
    expect(parseHistoryPage("historyPage=2.0")).toBe(1);
    expect(parseHistoryPage("historyPage=abc")).toBe(1);
    expect(parseHistoryPage("historyPage=")).toBe(1);
    expect(parseHistoryPage("historyPage=   ")).toBe(1);
    expect(parseHistoryPage("historyPage=1abc")).toBe(1);
  });
});
