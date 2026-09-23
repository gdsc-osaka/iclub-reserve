import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryErrorCode, type QueryError } from "~/query/error";

import { logQueryError, queryErrorResponse } from "./query-error.server";

const context = { where: "query.test", userId: "usr_01" };

const errorOf = (code: QueryErrorCode, extra: Partial<QueryError> = {}): QueryError => ({
  code,
  message: "ログ用の説明",
  ...extra,
});

beforeEach(() => {
  // ログの中身は個別のテストで確かめる。ここでは出力を黙らせるだけ
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("queryErrorResponse", () => {
  it.each([
    [QueryErrorCode.NotFound, 404, "info"],
    [QueryErrorCode.Forbidden, 403, "warn"],
    [QueryErrorCode.DatabaseError, 500, "error"],
  ] as const)("%s は %i で、%s でログに残る", (code, status, level) => {
    const spy = vi.spyOn(console, level).mockImplementation(() => {});

    const response = queryErrorResponse(context, errorOf(code));

    expect(response.init?.status).toBe(status);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ level, code, userId: "usr_01" }));
  });

  it("DB の失敗は、内部の事情を応答に出さない", () => {
    const response = queryErrorResponse(
      context,
      errorOf(QueryErrorCode.DatabaseError, { message: "D1_ERROR: no such table" }),
    );

    expect(JSON.stringify(response.data)).not.toContain("D1_ERROR");
  });

  it("userMessage を持っていても、応答には表の文言だけを出す", () => {
    // 画面ごと差し替える応答なので、フォームに向けた文言の出番が無い
    const response = queryErrorResponse(
      context,
      errorOf(QueryErrorCode.Forbidden, { userMessage: "事務局ではありません。" }),
    );

    expect(response.data).toEqual({ message: "この画面を表示する権限がありません。" });
  });
});

describe("logQueryError", () => {
  it("応答は作らず、分類に応じたレベルでログにだけ残す", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("connection reset");

    const returned = logQueryError(context, errorOf(QueryErrorCode.DatabaseError, { cause }));

    expect(returned).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        where: "query.test",
        code: "DATABASE_ERROR",
        kind: "internal",
        userId: "usr_01",
        cause: expect.objectContaining({ message: "connection reset" }),
      }),
    );
  });
});
