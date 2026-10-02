import { describe, expect, it } from "vitest";

import { USER_NAME_MAX_LENGTH, validatePasskeyName, validateUserName } from "./user-profile";

describe("validateUserName", () => {
  it('"" と "   " は失敗する', () => {
    const emptyResult = validateUserName("");
    expect(emptyResult.isErr()).toBe(true);
    if (emptyResult.isErr()) {
      expect(emptyResult.error.userMessage).toContain("入力してください");
    }

    const whitespaceResult = validateUserName("   ");
    expect(whitespaceResult.isErr()).toBe(true);
    if (whitespaceResult.isErr()) {
      expect(whitespaceResult.error.userMessage).toContain("入力してください");
    }
  });

  it('"　山田　太郎　"（前後が全角の空白）は "山田　太郎" になる', () => {
    const result = validateUserName("　山田　太郎　");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("山田　太郎");
    }
  });

  it("50 文字は通り、51 文字は失敗する", () => {
    const valid50 = "あ".repeat(50);
    const result50 = validateUserName(valid50);
    expect(result50.isOk()).toBe(true);
    if (result50.isOk()) {
      expect(result50.value).toBe(valid50);
    }

    const invalid51 = "あ".repeat(51);
    const result51 = validateUserName(invalid51);
    expect(result51.isErr()).toBe(true);
    if (result51.isErr()) {
      expect(result51.error.userMessage).toContain(`${USER_NAME_MAX_LENGTH} 文字以内`);
    }
  });

  it('"𠮷".repeat(50) は通り、"𠮷".repeat(51) は失敗する', () => {
    const validSurrogate50 = "𠮷".repeat(50);
    // サロゲートペアのため UTF-16 長は 100 だがコードポイント長は 50
    expect(validSurrogate50.length).toBe(100);
    const result50 = validateUserName(validSurrogate50);
    expect(result50.isOk()).toBe(true);
    if (result50.isOk()) {
      expect(result50.value).toBe(validSurrogate50);
    }

    const invalidSurrogate51 = "𠮷".repeat(51);
    const result51 = validateUserName(invalidSurrogate51);
    expect(result51.isErr()).toBe(true);
  });

  it("前後に空白が付いていて、除けば 50 文字になるものは通る", () => {
    const withPadding = `  ${"あ".repeat(50)}  `;
    const result = validateUserName(withPadding);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("あ".repeat(50));
    }
  });
});

describe("validatePasskeyName", () => {
  it("規則は validateUserName と共通で、文言だけがパスキー用であること", () => {
    const userEmpty = validateUserName("");
    const passkeyEmpty = validatePasskeyName("");

    expect(passkeyEmpty.isErr()).toBe(true);
    if (passkeyEmpty.isErr() && userEmpty.isErr()) {
      expect(passkeyEmpty.error.message).toContain("パスキー");
      expect(passkeyEmpty.error.userMessage).toContain("パスキー");
      // 文言が氏名用のものと異なっていること
      expect(passkeyEmpty.error.userMessage).not.toBe(userEmpty.error.userMessage);
    }

    const tooLongResult = validatePasskeyName("a".repeat(51));
    expect(tooLongResult.isErr()).toBe(true);
    if (tooLongResult.isErr()) {
      expect(tooLongResult.error.message).toContain("パスキー");
      expect(tooLongResult.error.userMessage).toContain("パスキー");
    }

    const validResult = validatePasskeyName("  My MacBook  ");
    expect(validResult.isOk()).toBe(true);
    if (validResult.isOk()) {
      expect(validResult.value).toBe("My MacBook");
    }
  });
});
