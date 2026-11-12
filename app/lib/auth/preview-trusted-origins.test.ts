import { describe, expect, it } from "vite-plus/test";
import { buildPreviewTrustedOrigins } from "./preview-trusted-origins";

const PREVIEW_URL = "https://iclub-preview.gdgoc-osaka.jp";
const PATTERN = "https://*.iclub-preview.gdgoc-osaka.jp";

describe("buildPreviewTrustedOrigins", () => {
  it("代表 URL のホスト名のサブドメインを許すパターンを作る", () => {
    // Worker Previews が発行する
    // https://feat-xxx.iclub-preview.gdgoc-osaka.jp に一致させるため
    expect(buildPreviewTrustedOrigins(PREVIEW_URL)).toEqual([PATTERN]);
  });

  it("パスが付いていてもホスト名だけを見る", () => {
    expect(buildPreviewTrustedOrigins(`${PREVIEW_URL}/login`)).toEqual([PATTERN]);
  });

  it("ポート番号は残す", () => {
    expect(buildPreviewTrustedOrigins("http://localhost:5173")).toEqual([
      "http://*.localhost:5173",
    ]);
  });

  it.each([undefined, "", "iclub-preview.gdgoc-osaka.jp"])(
    "URL として読めない %s のときは何も信頼しない",
    (baseURL) => {
      expect(
        buildPreviewTrustedOrigins(baseURL, "https://feat-x.iclub-preview.gdgoc-osaka.jp/"),
      ).toEqual([]);
    },
  );

  describe("リクエストを受けたブランチの origin", () => {
    it.each([
      // ブランチの URL
      [
        "https://feat-passkey.iclub-preview.gdgoc-osaka.jp/api/auth/passkey/verify-registration",
        "https://feat-passkey.iclub-preview.gdgoc-osaka.jp",
      ],
      // デプロイごとに固定の URL
      [
        "https://1a2b3c4d-feat-passkey.iclub-preview.gdgoc-osaka.jp/api/auth/passkey/verify-authentication",
        "https://1a2b3c4d-feat-passkey.iclub-preview.gdgoc-osaka.jp",
      ],
    ])("%s を受けたときは、パスキーの検証のために %s を完全一致で足す", (requestURL, origin) => {
      // passkey プラグインは、ワイルドカードではなく完全一致の origin だけを
      // 検証の期待値に加えるため
      expect(buildPreviewTrustedOrigins(PREVIEW_URL, requestURL)).toEqual([PATTERN, origin]);
    });

    it.each([
      // 代表 URL そのものは baseURL として Better Auth が信頼済み
      ["代表 URL そのもの", "https://iclub-preview.gdgoc-osaka.jp/api/auth/get-session"],
      ["代表 URL のホスト名で終わるだけの別のドメイン", "https://xiclub-preview.gdgoc-osaka.jp/"],
      ["本番のドメイン", "https://iclub.gdgoc-osaka.jp/"],
      ["スキームが違う", "http://feat-passkey.iclub-preview.gdgoc-osaka.jp/"],
      ["ポートが違う", "https://feat-passkey.iclub-preview.gdgoc-osaka.jp:8443/"],
      ["URL として読めない", "feat-passkey.iclub-preview.gdgoc-osaka.jp"],
      ["リクエストが無い（起動時の呼び出し）", undefined],
    ])("%s のときはパターンだけを返す", (_label, requestURL) => {
      expect(buildPreviewTrustedOrigins(PREVIEW_URL, requestURL)).toEqual([PATTERN]);
    });
  });
});
