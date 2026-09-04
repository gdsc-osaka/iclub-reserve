import { describe, expect, it } from "vitest";
import { LOGIN_METHODS, parseLoginMethod, toLoginMethodOrder } from "./login-method";

describe("parseLoginMethod", () => {
  it.each([...LOGIN_METHODS])("保存した %s をそのまま読み戻せる", (method) => {
    expect(parseLoginMethod(method)).toBe(method);
  });

  it.each([
    ["保存されていない", null],
    ["空文字", ""],
    ["知らない値", "password"],
    ["大文字が混ざっている", "Passkey"],
  ])("%s なら記録なしとして扱う", (_, raw) => {
    expect(parseLoginMethod(raw)).toBeNull();
  });
});

describe("toLoginMethodOrder", () => {
  it("記録がなければ既定の並び順のまま", () => {
    expect(toLoginMethodOrder(null)).toEqual(["email-otp", "passkey"]);
  });

  it("前回パスキーを使っていたらパスキーを先頭に出す", () => {
    expect(toLoginMethodOrder("passkey")).toEqual(["passkey", "email-otp"]);
  });

  it("前回メールの認証コードを使っていたら既定の並び順のまま", () => {
    expect(toLoginMethodOrder("email-otp")).toEqual(["email-otp", "passkey"]);
  });

  it.each([...LOGIN_METHODS])("%s が前回でも、すべての方法が 1 つずつ並ぶ", (method) => {
    expect(toLoginMethodOrder(method)).toHaveLength(LOGIN_METHODS.length);
    expect(new Set(toLoginMethodOrder(method))).toEqual(new Set(LOGIN_METHODS));
  });
});
