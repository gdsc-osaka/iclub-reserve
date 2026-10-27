import { describe, expect, it } from "vite-plus/test";

import { AppArea } from "~/lib/app-area";
import { readLastArea } from "./last-area-cookie";

const requestWithCookie = (cookie: string | null): Request =>
  new Request("https://example.com/", {
    headers: cookie === null ? undefined : { Cookie: cookie },
  });

describe("readLastArea", () => {
  it.each([
    ["利用者の画面", "iclub-reserve.last-area=user", AppArea.User],
    ["事務局の画面", "iclub-reserve.last-area=staff", AppArea.Staff],
    ["他の cookie に挟まれている", "a=1; iclub-reserve.last-area=staff; b=2", AppArea.Staff],
    ["値のない cookie のうしろにある", "consent; iclub-reserve.last-area=user", AppArea.User],
    ["percent encoding されている", "iclub-reserve.last-area=%73taff", AppArea.Staff],
  ])("%s のときは、その領域を返す", (_, cookie, expected) => {
    expect(readLastArea(requestWithCookie(cookie))).toBe(expected);
  });

  it.each([
    ["cookie がない", null],
    ["名前が違う", "last-area=staff"],
    ["名前の前に文字が付いている", "xiclub-reserve.last-area=staff"],
    ["名前のうしろに文字が付いている", "iclub-reserve.last-area-x=staff"],
    ["大文字が混ざっている", "iclub-reserve.last-area=Staff"],
    ["知らない領域", "iclub-reserve.last-area=admin"],
    ["値が空", "iclub-reserve.last-area="],
  ])("%s のときは、記録なしとして null を返す", (_, cookie) => {
    expect(readLastArea(requestWithCookie(cookie))).toBeNull();
  });

  it.each([
    ["% だけ", "iclub-reserve.last-area=%"],
    ["16 進数になっていない", "iclub-reserve.last-area=%zz"],
    ["桁が足りない", "iclub-reserve.last-area=%E3%81"],
  ])("percent encoding が壊れていても（%s）、例外を投げずに null を返す", (_, cookie) => {
    const request = requestWithCookie(cookie);

    expect(() => readLastArea(request)).not.toThrow();
    expect(readLastArea(request)).toBeNull();
  });
});
