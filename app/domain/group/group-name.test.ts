import { describe, expect, it } from "vitest";

import { GroupErrorCode } from "./index";
import { GROUP_NAME_MAX_LENGTH, validateGroupName } from "./group-name";

describe("validateGroupName", () => {
  it("普通の名前がそのまま ok で返る", () => {
    const result = validateGroupName("ロボティクス開発プロジェクト");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("ロボティクス開発プロジェクト");
  });

  it("前後に空白がある名前は、空白が落ちた値が返る", () => {
    const result = validateGroupName("  ロボティクス開発プロジェクト  ");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("ロボティクス開発プロジェクト");
  });

  it.each(["", "   ", "\t"])("空または空白文字のみ（%o）は GroupInvalidInput になる", (raw) => {
    const result = validateGroupName(raw);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.GroupInvalidInput);
    expect(error.message).toBe("団体名を入力してください。");
  });

  it.each([null, undefined])("値が %o のときは GroupInvalidInput になる", (raw) => {
    const result = validateGroupName(raw);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.GroupInvalidInput);
    expect(error.message).toBe("団体名を入力してください。");
  });

  it.each(["あ\nい", "あ\r\nい", "あ\tい"])(
    "改行やタブを含む名前（%o）は GroupInvalidInput になる",
    (raw) => {
      const result = validateGroupName(raw);

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(GroupErrorCode.GroupInvalidInput);
      expect(error.message).toBe("団体名に改行やタブは使えません。");
    },
  );

  it("ちょうど 64 文字の名前は通る", () => {
    const exactName = "あ".repeat(GROUP_NAME_MAX_LENGTH);
    const result = validateGroupName(exactName);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(exactName);
  });

  it("65 文字の名前は長すぎて通らない", () => {
    const overName = "あ".repeat(GROUP_NAME_MAX_LENGTH + 1);
    const result = validateGroupName(overName);

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(GroupErrorCode.GroupInvalidInput);
    expect(error.message).toBe(`団体名は ${GROUP_NAME_MAX_LENGTH} 文字以内で入力してください。`);
  });

  it("前後の空白を落とした結果で長さを測っている", () => {
    // 前後に空白があっても、trim 後の長さが 64 文字なら通る
    const paddedName = "  " + "あ".repeat(GROUP_NAME_MAX_LENGTH) + "  ";
    const result = validateGroupName(paddedName);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("あ".repeat(GROUP_NAME_MAX_LENGTH));
  });
});
