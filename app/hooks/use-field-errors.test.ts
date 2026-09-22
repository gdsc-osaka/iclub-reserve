import { describe, expect, it } from "vitest";

import { pickFieldError } from "./use-field-errors";

describe("pickFieldError", () => {
  const errors = {
    headCount: "使用人数は 1 以上の整数で入力してください。",
    note: "備考は 500 文字以内で入力してください。",
  };

  it("触っていない欄のエラーは、そのまま出す", () => {
    expect(pickFieldError(errors, new Set(), "headCount")).toBe(errors.headCount);
  });

  it("打ち直された欄のエラーは出さない。同じ送信の、他の欄のエラーは残る", () => {
    const editedFields = new Set(["headCount" as const]);

    expect(pickFieldError(errors, editedFields, "headCount")).toBeUndefined();
    expect(pickFieldError(errors, editedFields, "note")).toBe(errors.note);
  });

  it("エラーが無いときは undefined を返す", () => {
    expect(pickFieldError(null, new Set<"name">(), "name")).toBeUndefined();
    expect(pickFieldError(undefined, new Set<"name">(), "name")).toBeUndefined();
    // 文言が null の欄も「エラー無し」として扱う
    expect(pickFieldError({ name: null }, new Set(), "name")).toBeUndefined();
  });
});
