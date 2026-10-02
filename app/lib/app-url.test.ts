import { describe, expect, it } from "vitest";
import { toMailableOrigin } from "./app-url";

describe("toMailableOrigin", () => {
  it("https の URL は origin だけを返す", () => {
    expect(toMailableOrigin("https://example.com/path?a=1#b")).toBe("https://example.com");
  });

  it("ポート付きの http も通る（ローカル開発で使う）", () => {
    expect(toMailableOrigin("http://localhost:5173")).toBe("http://localhost:5173");
  });

  it.each([null, undefined, "", "   ", "example.com", "/invitations/abc"])(
    "%s のように URL として読めない値は null を返す",
    (input) => {
      expect(toMailableOrigin(input)).toBeNull();
    },
  );

  /*
   * URL.canParse はこれらも真にするが、origin は文字列 "null" になる。
   * 素通しするとメールのリンクが "null/invitations/xxx" になってしまうので、必ず弾く。
   */
  it.each(["mailto:taro@osaka-u.ac.jp", "ftp://example.com", "javascript:alert(1)"])(
    "%s のように http(s) 以外のスキームは null を返す",
    (input) => {
      expect(toMailableOrigin(input)).toBeNull();
    },
  );
});
