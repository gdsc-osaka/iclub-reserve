import { describe, expect, it } from "vitest";
import { buildPreviewTrustedOrigins } from "./preview-trusted-origins";

const PREVIEW_URL = "https://iclub-reserve-preview.gdsc-osaka.workers.dev";

describe("buildPreviewTrustedOrigins", () => {
  it("代表 URL のホスト名に前置きを許すパターンを作る", () => {
    // Workers Builds が発行する
    // https://feat-xxx-iclub-reserve-preview.gdsc-osaka.workers.dev に一致させるため
    expect(buildPreviewTrustedOrigins(PREVIEW_URL)).toEqual([
      "https://*-iclub-reserve-preview.gdsc-osaka.workers.dev",
    ]);
  });

  it("パスが付いていてもホスト名だけを見る", () => {
    expect(buildPreviewTrustedOrigins(`${PREVIEW_URL}/login`)).toEqual([
      "https://*-iclub-reserve-preview.gdsc-osaka.workers.dev",
    ]);
  });

  it("ポート番号は残す", () => {
    expect(buildPreviewTrustedOrigins("http://localhost:5173")).toEqual([
      "http://*-localhost:5173",
    ]);
  });

  it.each([undefined, "", "iclub-reserve-preview.gdsc-osaka.workers.dev"])(
    "URL として読めない %s のときは何も信頼しない",
    (baseURL) => {
      expect(buildPreviewTrustedOrigins(baseURL)).toEqual([]);
    },
  );
});
