import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEV_PASSKEY_AUTOFILL_STORAGE_KEY,
  isPasskeyAutofillTurnedOffForDev,
} from "./dev-passkey-autofill-switch";

/** 指定した値だけを持つ localStorage に差し替える。null を渡すと、キーが無い状態にする */
const stubStorage = (value: string | null) => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === DEV_PASSKEY_AUTOFILL_STORAGE_KEY ? value : null),
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("isPasskeyAutofillTurnedOffForDev", () => {
  it("開発サーバーで印が off なら、止める", () => {
    vi.stubEnv("DEV", true);
    stubStorage("off");

    expect(isPasskeyAutofillTurnedOffForDev()).toBe(true);
  });

  it.each([
    ["印が無い", null],
    ["印が off 以外", "on"],
  ])("%s ときは、止めない", (_, value) => {
    vi.stubEnv("DEV", true);
    stubStorage(value);

    expect(isPasskeyAutofillTurnedOffForDev()).toBe(false);
  });

  it("ビルドしたアプリ（本番・プレビュー・E2E）では、印があっても止めない", () => {
    vi.stubEnv("DEV", false);
    stubStorage("off");

    expect(isPasskeyAutofillTurnedOffForDev()).toBe(false);
  });

  it("localStorage を読めない環境では、止めない", () => {
    vi.stubEnv("DEV", true);
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });

    expect(isPasskeyAutofillTurnedOffForDev()).toBe(false);
  });
});
