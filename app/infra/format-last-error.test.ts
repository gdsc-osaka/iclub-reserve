import { describe, expect, it } from "vite-plus/test";
import { formatLastError } from "./format-last-error";

describe("formatLastError", () => {
  it("原因が無ければ、エラーコードだけにする", () => {
    expect(formatLastError({ code: "CALENDAR_UNAVAILABLE" })).toBe("CALENDAR_UNAVAILABLE");
    expect(formatLastError({ code: "CALENDAR_UNAVAILABLE", cause: "" })).toBe(
      "CALENDAR_UNAVAILABLE",
    );
  });

  it("文字列の原因は、そのまま後ろに付ける", () => {
    expect(formatLastError({ code: "MAIL_UNAVAILABLE", cause: "HTTP 503: busy" })).toBe(
      "MAIL_UNAVAILABLE: HTTP 503: busy",
    );
  });

  it("例外は、名前とメッセージにする", () => {
    expect(
      formatLastError({ code: "MAIL_UNAVAILABLE", cause: new TypeError("fetch failed") }),
    ).toBe("MAIL_UNAVAILABLE: TypeError: fetch failed");
  });

  it("JSON を読んだオブジェクトは、[object Object] ではなく中身を JSON で残す", () => {
    const cause = { error: "invalid_grant", error_description: "Invalid JWT Signature." };

    expect(formatLastError({ code: "CALENDAR_AUTH_FAILED", cause })).toBe(
      'CALENDAR_AUTH_FAILED: {"error":"invalid_grant","error_description":"Invalid JWT Signature."}',
    );
  });

  it("JSON にできない原因でも、落ちずにコードを残す", () => {
    const cause: Record<string, unknown> = {};
    cause.self = cause;

    expect(formatLastError({ code: "CALENDAR_UNAVAILABLE", cause })).toBe(
      "CALENDAR_UNAVAILABLE: （文字列にできない値）",
    );
  });
});
