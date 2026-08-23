import { describe, expect, it } from "vitest";
import { isProfileCompleted } from "./user-profile";

describe("isProfileCompleted", () => {
  it.each([
    ["お名前が入っている", "大阪 太郎"],
    ["前後に空白がある", "  大阪 太郎  "],
  ])("%s なら登録済みとみなす", (_, name) => {
    expect(isProfileCompleted({ name })).toBe(true);
  });

  it.each([
    ["空文字（アカウントを作った直後）", ""],
    ["空白だけ", "   "],
  ])("%s なら未登録とみなす", (_, name) => {
    expect(isProfileCompleted({ name })).toBe(false);
  });
});
