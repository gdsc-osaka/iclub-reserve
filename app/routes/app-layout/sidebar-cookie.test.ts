import { describe, expect, it } from "vitest";

import { readSidebarDefaultOpen } from "./sidebar-cookie";

const requestWithCookie = (cookie: string | null): Request =>
  new Request("https://example.com/", {
    headers: cookie === null ? undefined : { Cookie: cookie },
  });

describe("readSidebarDefaultOpen", () => {
  it("クッキーが無いときは開いた状態にする", () => {
    expect(readSidebarDefaultOpen(requestWithCookie(null))).toBe(true);
  });

  it("畳んだ状態を覚えているときは閉じた状態にする", () => {
    expect(readSidebarDefaultOpen(requestWithCookie("sidebar_state=false"))).toBe(false);
  });

  it("開いた状態を覚えているときは開いた状態にする", () => {
    expect(readSidebarDefaultOpen(requestWithCookie("sidebar_state=true"))).toBe(true);
  });

  // ほかのクッキーに混ざっていても読めること。名前の前後の空白で取り違えやすい
  it("ほかのクッキーと並んでいても読める", () => {
    expect(
      readSidebarDefaultOpen(requestWithCookie("session=abc; sidebar_state=false; theme=dark")),
    ).toBe(false);
  });

  // 名前が部分一致する別のクッキーに引きずられないこと
  it("名前が似た別のクッキーは見ない", () => {
    expect(readSidebarDefaultOpen(requestWithCookie("my_sidebar_state=false"))).toBe(true);
  });
});
