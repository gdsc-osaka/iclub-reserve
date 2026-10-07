import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupErrorCode } from "~/domain/group";
import { StaffErrorCode, StaffField, type StaffError } from "~/domain/staff";
import { invitationErrorResponse } from "./group-error.server";
import {
  staffActionErrors,
  staffErrorResponse,
  staffInvitationActionErrors,
  staffInvitationErrorResponse,
} from "./staff-error.server";

const context = { where: "staff.test", userId: "usr_01" };

const errorOf = (code: StaffErrorCode, extra: Partial<StaffError> = {}): StaffError => ({
  code,
  message: "ログ用の説明",
  ...extra,
});

const thrownBy = <T>(fn: () => T): unknown => {
  try {
    fn();
    expect.unreachable("例外が投げられるはず");
  } catch (error) {
    return error;
  }
};

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

  it("InvitationNotVisible は 409 になる", () => {
    const response = staffErrorResponse(context, errorOf(StaffErrorCode.InvitationNotVisible));
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

describe("COND-015: 宛先が本人ではない招待は、無い招待と同じ応答になる（事務局招待の承諾画面 SCR-020）", () => {
  it("loader の応答（status と中身）が InvitationNotFound と同一になる", () => {
    const notVisible = staffInvitationErrorResponse(
      context,
      errorOf(StaffErrorCode.InvitationNotVisible),
    );
    const notFound = staffInvitationErrorResponse(
      context,
      errorOf(StaffErrorCode.InvitationNotFound),
    );

    expect(notVisible.init?.status).toBe(404);
    expect(notVisible).toEqual(notFound);
  });

  it("action でも InvitationNotFound と同一の 404 を投げる", () => {
    const notVisible = thrownBy(() =>
      staffInvitationActionErrors(context, errorOf(StaffErrorCode.InvitationNotVisible)),
    );
    const notFound = thrownBy(() =>
      staffInvitationActionErrors(context, errorOf(StaffErrorCode.InvitationNotFound)),
    );

    expect(notVisible).toEqual(
      staffInvitationErrorResponse(context, errorOf(StaffErrorCode.InvitationNotFound)),
    );
    expect(notVisible).toEqual(notFound);
  });

  it("InvitationNotVisible に userMessage が付いていても、応答には出ない", () => {
    const leaked = staffInvitationErrorResponse(
      context,
      errorOf(StaffErrorCode.InvitationNotVisible, {
        userMessage: "この招待は別のメールアドレス宛てです。",
      }),
    );

    expect(leaked).toEqual(
      staffInvitationErrorResponse(context, errorOf(StaffErrorCode.InvitationNotFound)),
    );
  });

  it("ログには秘匿せず、InvitationNotVisible として warn で残る", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    staffInvitationErrorResponse(context, errorOf(StaffErrorCode.InvitationNotVisible));

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "warn",
        code: "STAFF_INVITATION_NOT_VISIBLE",
        kind: "forbidden",
        userId: "usr_01",
      }),
    );
  });

  it("団体の招待と事務局の招待で「見つからない」応答の文言が同じであること", () => {
    const groupResp = invitationErrorResponse(context, {
      code: GroupErrorCode.InvitationNotFound,
      message: "ログ用",
    });
    const staffResp = staffInvitationErrorResponse(
      context,
      errorOf(StaffErrorCode.InvitationNotFound),
    );

    expect(staffResp.init?.status).toBe(404);
    expect(groupResp.init?.status).toBe(404);
    expect(staffResp.data).toEqual(groupResp.data);
  });
});
