import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_CACHE_CONTROL, withDefaultCacheControl } from "./default-cache-control.server";

describe("withDefaultCacheControl", () => {
  it("Cache-Control が無い応答に、既定の値を付ける", async () => {
    const response = withDefaultCacheControl(
      new Response("<p>ダッシュボード</p>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    expect(response.headers.get("Cache-Control")).toBe(DEFAULT_CACHE_CONTROL);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html");
    expect(await response.text()).toBe("<p>ダッシュボード</p>");
  });

  it("既定の値は、共有のキャッシュにもブラウザにも残させない", () => {
    expect(DEFAULT_CACHE_CONTROL).toContain("private");
    expect(DEFAULT_CACHE_CONTROL).toContain("no-store");
  });

  it("ルートが付けた Cache-Control は書き換えず、同じ応答を返す", () => {
    const original = new Response("写真", {
      headers: { "Cache-Control": "private, max-age=31536000, immutable" },
    });

    const response = withDefaultCacheControl(original);

    expect(response).toBe(original);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
  });

  it("ヘッダーを書き換えられないリダイレクトにも付けられる", () => {
    const response = withDefaultCacheControl(Response.redirect("https://example.com/login", 302));

    expect(response.headers.get("Cache-Control")).toBe(DEFAULT_CACHE_CONTROL);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://example.com/login");
  });

  it("複数の Set-Cookie を 1 つにまとめずに残す", () => {
    const headers = new Headers();
    headers.append("Set-Cookie", "session=abc; Path=/; HttpOnly");
    headers.append("Set-Cookie", "csrf=xyz; Path=/");

    const response = withDefaultCacheControl(new Response(null, { status: 204, headers }));

    expect(response.headers.getSetCookie()).toEqual([
      "session=abc; Path=/; HttpOnly",
      "csrf=xyz; Path=/",
    ]);
  });

  it("status の説明（statusText）も引き継ぐ", () => {
    const response = withDefaultCacheControl(
      new Response("見つかりません", { status: 404, statusText: "Not Found" }),
    );

    expect(response.status).toBe(404);
    expect(response.statusText).toBe("Not Found");
  });
});
