import { describe, expect, it } from "vitest";

import { findPasskeyProvider } from "./passkey-provider";

const SVG_DATA_URI_PREFIX = "data:image/svg+xml;base64,";

describe("findPasskeyProvider", () => {
  it("一覧にある AAGUID なら、名前とアイコンを返す", () => {
    const provider = findPasskeyProvider("ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4");

    expect(provider?.name).toBe("Google Password Manager");
    expect(provider?.icon?.light.startsWith(SVG_DATA_URI_PREFIX)).toBe(true);
    expect(provider?.icon?.dark.startsWith(SVG_DATA_URI_PREFIX)).toBe(true);
  });

  it("明るい背景用と暗い背景用のアイコンが違う提供元は、それぞれを返す", () => {
    const provider = findPasskeyProvider("bada5566-a7aa-401f-bd96-45619a55120d");

    expect(provider?.name).toBe("1Password");
    expect(provider?.icon?.light).not.toBe(provider?.icon?.dark);
  });

  it("大文字や前後の空白が混ざっていても引ける", () => {
    expect(findPasskeyProvider("  EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4 ")?.name).toBe(
      "Google Password Manager",
    );
  });

  it("アイコンが無い提供元は、名前だけを返す", () => {
    const provider = findPasskeyProvider("b5397666-4885-aa6b-cebf-e52262a439a2");

    expect(provider).toEqual({ name: "Chromium Browser", icon: null });
  });

  it.each([
    ["全桁 0（iCloud キーチェーンなど提供元を隠す端末）", "00000000-0000-0000-0000-000000000000"],
    ["一覧に無い", "12345678-1234-1234-1234-123456789abc"],
    ["Object の組み込みの名前", "toString"],
    ["空文字", ""],
    ["null", null],
    ["undefined", undefined],
  ])("%s なら null", (_label, aaguid) => {
    expect(findPasskeyProvider(aaguid)).toBeNull();
  });
});
