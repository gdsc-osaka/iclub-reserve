import { describe, expect, it } from "vite-plus/test";

import { flashToastHeaders, readFlashToast } from "./flash-toast.server";

describe("flash-toast.server", () => {
  it("書いたものを読むと同じ title と description が返る", () => {
    const writeReq = new Request("https://example.com/action");
    const headers = flashToastHeaders(writeReq, {
      title: "予約を承認しました",
      description: "重なっていた仮予約 2 件を却下しました。",
    });

    const setCookie = headers.get("Set-Cookie");
    expect(setCookie).toBeTruthy();

    const cookiePair = setCookie?.split(";")[0];
    const readReq = new Request("https://example.com/next", {
      headers: { Cookie: cookiePair ?? "" },
    });

    const result = readFlashToast(readReq);
    expect(result.toast).not.toBeNull();
    expect(result.toast?.title).toBe("予約を承認しました");
    expect(result.toast?.description).toBe("重なっていた仮予約 2 件を却下しました。");
    expect(result.toast?.id).toBeTruthy();
    expect(result.headers?.get("Set-Cookie")).toContain("Max-Age=0");
  });

  it("description が無いときも正しく読み取れる", () => {
    const writeReq = new Request("https://example.com/action");
    const headers = flashToastHeaders(writeReq, {
      title: "団体名を変更しました",
    });

    const setCookie = headers.get("Set-Cookie");
    const cookiePair = setCookie?.split(";")[0];
    const readReq = new Request("https://example.com/next", {
      headers: { Cookie: cookiePair ?? "" },
    });

    const result = readFlashToast(readReq);
    expect(result.toast).not.toBeNull();
    expect(result.toast?.title).toBe("団体名を変更しました");
    expect(result.toast?.description).toBeUndefined();
  });

  it("https のときだけ Secure が付く", () => {
    const httpsReq = new Request("https://example.com/action");
    const httpsHeaders = flashToastHeaders(httpsReq, { title: "テスト" });
    expect(httpsHeaders.get("Set-Cookie")).toContain("; Secure");

    const httpReq = new Request("http://localhost:5173/action");
    const httpHeaders = flashToastHeaders(httpReq, { title: "テスト" });
    expect(httpHeaders.get("Set-Cookie")).not.toContain("; Secure");
  });

  it("Cookie が無いときは toast が null かつ headers が undefined", () => {
    const req = new Request("https://example.com/");
    const result = readFlashToast(req);
    expect(result.toast).toBeNull();
    expect(result.headers).toBeUndefined();
  });

  it("壊れた JSON のときは toast が null で、消す Set-Cookie が付く", () => {
    const req = new Request("https://example.com/", {
      headers: {
        Cookie: "iclub-reserve.flash-toast=invalid-json-string",
      },
    });

    const result = readFlashToast(req);
    expect(result.toast).toBeNull();
    expect(result.headers?.get("Set-Cookie")).toContain("Max-Age=0");
    expect(result.headers?.get("Set-Cookie")).toContain("; Secure");
  });

  it("title が 200 文字を超えるときは toast が null で、消す Set-Cookie が付く", () => {
    const tooLongTitle = "a".repeat(201);
    const value = encodeURIComponent(JSON.stringify({ title: tooLongTitle }));
    const req = new Request("http://localhost:5173/", {
      headers: {
        Cookie: `iclub-reserve.flash-toast=${value}`,
      },
    });

    const result = readFlashToast(req);
    expect(result.toast).toBeNull();
    expect(result.headers?.get("Set-Cookie")).toContain("Max-Age=0");
    expect(result.headers?.get("Set-Cookie")).not.toContain("; Secure");
  });

  it("description が 500 文字を超えるときは toast が null で、消す Set-Cookie が付く", () => {
    const tooLongDescription = "a".repeat(501);
    const value = encodeURIComponent(
      JSON.stringify({ title: "タイトル", description: tooLongDescription }),
    );
    const req = new Request("https://example.com/", {
      headers: {
        Cookie: `iclub-reserve.flash-toast=${value}`,
      },
    });

    const result = readFlashToast(req);
    expect(result.toast).toBeNull();
    expect(result.headers?.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
