import { describe, expect, it } from "vitest";
import { buildPreviewTrustedOrigins } from "./preview-trusted-origins";

const PREVIEW_URL = "https://iclub-preview.gdgoc-osaka.jp";

describe("buildPreviewTrustedOrigins", () => {
  it("代表 URL のホスト名のサブドメインを許すパターンを作る", () => {
    // Worker Previews が発行する
    // https://feat-xxx.iclub-preview.gdgoc-osaka.jp に一致させるため
    expect(buildPreviewTrustedOrigins(PREVIEW_URL)).toEqual([
      "https://*.iclub-preview.gdgoc-osaka.jp",
    ]);
  });

  it("パスが付いていてもホスト名だけを見る", () => {
    expect(buildPreviewTrustedOrigins(`${PREVIEW_URL}/login`)).toEqual([
      "https://*.iclub-preview.gdgoc-osaka.jp",
    ]);
  });

  it("ポート番号は残す", () => {
    expect(buildPreviewTrustedOrigins("http://localhost:5173")).toEqual([
      "http://*.localhost:5173",
    ]);
  });

  it.each([undefined, "", "iclub-preview.gdgoc-osaka.jp"])(
    "URL として読めない %s のときは何も信頼しない",
    (baseURL) => {
      expect(buildPreviewTrustedOrigins(baseURL)).toEqual([]);
    },
  );
});
