import { describe, expect, it } from "vitest";

import { readLastLoginMethod } from "./last-login-method-cookie";

/** Cookie ヘッダーを付けたリクエストを作る。null を渡すとヘッダーごと付けない。 */
const requestWithCookie = (cookie: string | null): Request =>
  new Request("https://example.com/login", {
    headers: cookie === null ? undefined : { Cookie: cookie },
  });

describe("readLastLoginMethod", () => {
  it.each([
    ["パスキー", "iclub-reserve.last-login-method=passkey", "passkey"],
    ["メールの認証コード", "iclub-reserve.last-login-method=email-otp", "email-otp"],
    ["他の cookie に挟まれている", "a=1; iclub-reserve.last-login-method=passkey; b=2", "passkey"],
    [
      "値のない cookie のうしろにある",
      "consent; iclub-reserve.last-login-method=passkey",
      "passkey",
    ],
    ["percent encoding されている", "iclub-reserve.last-login-method=%70asskey", "passkey"],
  ])("%s のときは、その方法を返す", (_, cookie, expected) => {
    expect(readLastLoginMethod(requestWithCookie(cookie))).toBe(expected);
  });

  it.each([
    ["cookie がない", null],
    ["名前が違う", "last-login-method=passkey"],
    ["名前の前に文字が付いている", "xiclub-reserve.last-login-method=passkey"],
    ["名前のうしろに文字が付いている", "iclub-reserve.last-login-method-x=passkey"],
    ["大文字が混ざっている", "iclub-reserve.last-login-method=Passkey"],
    ["知らない方法", "iclub-reserve.last-login-method=password"],
    ["値が空", "iclub-reserve.last-login-method="],
  ])("%s のときは、記録なしとして null を返す", (_, cookie) => {
    expect(readLastLoginMethod(requestWithCookie(cookie))).toBeNull();
  });

  // 壊れた cookie でログイン画面自体が開けなくなると、
  // 利用者は cookie を消すまで何もできなくなってしまう。
  it.each([
    ["% だけ", "iclub-reserve.last-login-method=%"],
    ["16 進数になっていない", "iclub-reserve.last-login-method=%zz"],
    ["桁が足りない", "iclub-reserve.last-login-method=%E3%81"],
  ])("percent encoding が壊れていても（%s）、例外を投げずに null を返す", (_, cookie) => {
    const request = requestWithCookie(cookie);

    expect(() => readLastLoginMethod(request)).not.toThrow();
    expect(readLastLoginMethod(request)).toBeNull();
  });
});
