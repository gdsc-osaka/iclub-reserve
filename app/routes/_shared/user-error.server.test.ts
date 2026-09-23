import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UserErrorCode, type UserError } from "~/domain/user";

import { userActionErrors, userErrorResponse, userErrorView } from "./user-error.server";

const context = { where: "account.test", userId: "usr_01" };

const errorOf = (code: UserErrorCode, extra: Partial<UserError> = {}): UserError => ({
  code,
  message: "ログ用の説明",
  ...extra,
});

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("userErrorView", () => {
  it("UserErrorCode のすべてのコードを網羅している", () => {
    const codes = Object.values(UserErrorCode);
    for (const code of codes) {
      expect(userErrorView[code]).toBeDefined();
      expect(userErrorView[code].message).toBeTruthy();
    }
  });

  it("SessionNotFound は 409 で読み込み直しの案内を出す", () => {
    expect(userErrorView[UserErrorCode.SessionNotFound].status).toBe(409);
    expect(userErrorView[UserErrorCode.SessionNotFound].message).toContain(
      "対象の端末が見つかりませんでした。画面を読み込み直してください。",
    );
  });
});

describe("userErrorResponse", () => {
  it("NotFound は 404 でログに info が残る", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = userErrorResponse(context, errorOf(UserErrorCode.NotFound));

    expect(response.init?.status).toBe(404);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info", code: "USER_NOT_FOUND", userId: "usr_01" }),
    );
  });

  it("DatabaseError は 500 でログに error が残る", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = userErrorResponse(
      context,
      errorOf(UserErrorCode.DatabaseError, { message: "D1 error" }),
    );

    expect(response.init?.status).toBe(500);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", code: "DATABASE_ERROR" }),
    );
  });
});

describe("userActionErrors", () => {
  it("SessionNotFound は formError にメッセージを返す", () => {
    const errors = userActionErrors(context, errorOf(UserErrorCode.SessionNotFound));

    expect(errors.formError).toBe(
      "対象の端末が見つかりませんでした。画面を読み込み直してください。",
    );
  });

  it("CurrentSession は formError にメッセージを返す", () => {
    const errors = userActionErrors(context, errorOf(UserErrorCode.CurrentSession));

    expect(errors.formError).toBe(
      "利用中の端末はログアウトできません。通常のログアウトをご利用ください。",
    );
  });

  it("userMessage があればそれを優先する", () => {
    const errors = userActionErrors(
      context,
      errorOf(UserErrorCode.CurrentSession, { userMessage: "カスタムのエラー" }),
    );

    expect(errors.formError).toBe("カスタムのエラー");
  });
});
