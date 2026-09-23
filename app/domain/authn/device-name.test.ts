import { describe, expect, it } from "vitest";

import { toDeviceName, toPasskeyLabel, toPasskeyName } from "./device-name";

describe("toDeviceName", () => {
  it.each([
    [
      "Windows の Chrome",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
    [
      "Windows の Edge",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
    ],
    [
      "Windows の Firefox",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    ],
    [
      "Mac の Safari",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    ],
    [
      "Mac の Chrome",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
    [
      "iPhone の Safari",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1",
    ],
    [
      "iPhone の Chrome",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
    ],
    [
      "iPad の Safari",
      "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
    ],
    [
      "Android の Chrome",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
    ],
    [
      "Android の Samsung Internet",
      "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
    ],
    ["Linux の Firefox", "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"],
    [
      "ChromeOS の Chrome",
      "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ],
    ["Windows のブラウザ", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) UnknownCustomEngine/1.0"],
    ["Chrome", "CustomEngine/1.0 Chrome/120.0.0.0"],
    ["不明な端末", null],
    ["不明な端末", ""],
    ["不明な端末", "   "],
    ["不明な端末", "some completely unrecognizable user agent string"],
  ])("UA から '%s' を判定できる", (expected, ua) => {
    expect(toDeviceName(ua)).toBe(expected);
  });
});

describe("toPasskeyName", () => {
  it("Google Password Manager の AAGUID（ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4）ならその名前になる", () => {
    const name = toPasskeyName({
      aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });
    expect(name).toBe("Google Password Manager");
  });

  it("AAGUID が全桁 0 で UA があれば端末名になる", () => {
    const name = toPasskeyName({
      aaguid: "00000000-0000-0000-0000-000000000000",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    });
    expect(name).toBe("Mac の Safari");
  });
});

describe("toPasskeyLabel", () => {
  it("名前があればそれを使う", () => {
    expect(
      toPasskeyLabel({ name: "カスタムパスキー", aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4" }),
    ).toBe("カスタムパスキー");
  });

  it("名前が無く AAGUID が判明していれば認証器の名前になる", () => {
    expect(
      toPasskeyLabel({
        name: null,
        aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
      }),
    ).toBe("Google Password Manager");
  });

  it("名前が null で AAGUID が不明（または全桁0）なら「パスキー」になる", () => {
    expect(toPasskeyLabel({ name: null, aaguid: null })).toBe("パスキー");
    expect(toPasskeyLabel({ name: null, aaguid: "00000000-0000-0000-0000-000000000000" })).toBe(
      "パスキー",
    );
    expect(toPasskeyLabel({ name: "  ", aaguid: "unknown-aaguid" })).toBe("パスキー");
  });
});
