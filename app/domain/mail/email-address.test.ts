import { describe, expect, it } from "vitest";
import { createEmailAddress } from "./email-address";

describe("createEmailAddress", () => {
  it("正しい形式のメールアドレスを受け入れる", () => {
    const result = createEmailAddress("taro@osaka-u.ac.jp");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.value).toBe("taro@osaka-u.ac.jp");
  });

  it("前後の空白を取り除く", () => {
    const result = createEmailAddress("  taro@osaka-u.ac.jp  ");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.value).toBe("taro@osaka-u.ac.jp");
  });

  it.each([
    ["空文字", ""],
    ["空白のみ", "   "],
    ["@ がない", "taro.osaka-u.ac.jp"],
    ["ローカル部がない", "@osaka-u.ac.jp"],
    ["ドメイン部がない", "taro@"],
    ["トップレベルドメインがない", "taro@osaka-u"],
    ["空白を含む", "ta ro@osaka-u.ac.jp"],
    ["@ が 2 つある", "taro@@osaka-u.ac.jp"],
  ])("%s の場合は invalid_email_address を返す", (_, input) => {
    const result = createEmailAddress(input);

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.type).toBe("invalid_email_address");
  });

  it("254 文字を超える場合は拒否する", () => {
    const localPart = "a".repeat(250);
    const result = createEmailAddress(`${localPart}@osaka-u.ac.jp`);

    expect(result.isErr()).toBe(true);
  });
});
