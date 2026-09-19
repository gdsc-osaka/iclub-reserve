import { describe, expect, it } from "vitest";
import { ALLOWED_EMAIL_DOMAINS_LABEL, isAllowedEmailAddress } from "./allowed-email-domain";

describe("isAllowedEmailAddress", () => {
  it.each([
    ["大学のドメイン", "taro@osaka-u.ac.jp"],
    ["学生用のサブドメイン", "u123456a@ecs.osaka-u.ac.jp"],
    ["部局のサブドメイン", "hanako@ist.osaka-u.ac.jp"],
    ["大文字が混ざっている", "Taro@Osaka-U.ac.jp"],
    ["前後に空白がある", "  taro@osaka-u.ac.jp  "],
  ])("%s は許可する", (_, email) => {
    expect(isAllowedEmailAddress(email)).toBe(true);
  });

  it.each([
    ["別のドメイン", "taro@example.com"],
    ["フリーメール", "taro@gmail.com"],
    ["末尾が似ているだけの別ドメイン", "taro@notosaka-u.ac.jp"],
    ["許可ドメインを前方に含む別ドメイン", "taro@osaka-u.ac.jp.example.com"],
    ["空文字", ""],
    ["@ がない", "taro.osaka-u.ac.jp"],
    ["ローカル部がない", "@osaka-u.ac.jp"],
    ["ドメイン部がない", "taro@"],
  ])("%s は許可しない", (_, email) => {
    expect(isAllowedEmailAddress(email)).toBe(false);
  });
});

describe("ALLOWED_EMAIL_DOMAINS_LABEL", () => {
  it("画面に出せる形（@ 付き）になっている", () => {
    expect(ALLOWED_EMAIL_DOMAINS_LABEL).toBe("@osaka-u.ac.jp");
  });
});
