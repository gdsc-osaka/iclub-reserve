import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaffErrorCode, StaffField, type StaffError } from "~/domain/staff";
import { staffActionErrors, staffErrorResponse } from "./staff-error.server";

const context = { where: "staff.test", userId: "usr_01" };

const errorOf = (code: StaffErrorCode, extra: Partial<StaffError> = {}): StaffError => ({
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

describe("staffErrorResponse", () => {
  it("権限拒否（Forbidden）は 403 で、warn でログに残る", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = staffErrorResponse(context, errorOf(StaffErrorCode.Forbidden));

    expect(response.init?.status).toBe(403);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", code: "STAFF_FORBIDDEN", userId: "usr_01" }),
    );
  });

  it("DB の失敗は 500 で、内部の事情を応答に出さず、error でログに残る", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = staffErrorResponse(
      context,
      errorOf(StaffErrorCode.DatabaseError, { message: "D1_ERROR: internal failure" }),
    );

    expect(response.init?.status).toBe(500);
    expect(JSON.stringify(response.data)).not.toContain("D1_ERROR");
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", code: "DATABASE_ERROR" }),
    );
  });

  it("InvitationNotFound は既定の 404 を破って 409 になる", () => {
    const response = staffErrorResponse(context, errorOf(StaffErrorCode.InvitationNotFound));
    expect(response.init?.status).toBe(409);
  });

  it("MemberNotFound は既定の 404 を破って 409 になる", () => {
    const response = staffErrorResponse(context, errorOf(StaffErrorCode.MemberNotFound));
    expect(response.init?.status).toBe(409);
  });

  it("LastStaffRequired は 409 になる", () => {
    const response = staffErrorResponse(context, errorOf(StaffErrorCode.LastStaffRequired));
    expect(response.init?.status).toBe(409);
  });

  it("Conflict は 409 になる", () => {
    const response = staffErrorResponse(context, errorOf(StaffErrorCode.Conflict));
    expect(response.init?.status).toBe(409);
  });
});

describe("staffActionErrors", () => {
  it("field マッピングが指定されていれば、その欄のエラーとして返す", () => {
    const actionErrors = staffActionErrors(
      context,
      errorOf(StaffErrorCode.InvalidInput, {
        field: StaffField.Email,
        userMessage: "メールアドレスの形式が正しくありません。",
      }),
      { [StaffField.Email]: "emailError" },
    );

    expect(actionErrors).toEqual({
      formError: null,
      emailError: "メールアドレスの形式が正しくありません。",
    });
  });

  it("field が無い、またはマッピングに無い場合は formError に入る", () => {
    const actionErrors = staffActionErrors(
      context,
      errorOf(StaffErrorCode.LastStaffRequired, {
        userMessage: "事務局が 0 人になるため、剥奪できません。",
      }),
    );

    expect(actionErrors).toEqual({
      formError: "事務局が 0 人になるため、剥奪できません。",
    });
  });
});
