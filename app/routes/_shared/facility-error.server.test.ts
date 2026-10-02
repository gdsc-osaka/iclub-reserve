import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FacilityErrorCode, FacilityField, type FacilityError } from "~/domain/facility";

import { facilityActionErrors, facilityErrorResponse } from "./facility-error.server";

const context = { where: "facility.test", userId: "usr_01" };

const errorOf = (code: FacilityErrorCode, extra: Partial<FacilityError> = {}): FacilityError => ({
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

describe("facilityErrorResponse", () => {
  it("無い施設は 404 で、info でログに残る", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = facilityErrorResponse(context, errorOf(FacilityErrorCode.NotFound));

    expect(response.init?.status).toBe(404);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info", code: "FACILITY_NOT_FOUND", userId: "usr_01" }),
    );
  });

  it("DB の失敗は 500 で、内部の事情を応答に出さず、error でログに残る", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = facilityErrorResponse(
      context,
      errorOf(FacilityErrorCode.DatabaseError, { message: "D1_ERROR: no such table" }),
    );

    expect(response.init?.status).toBe(500);
    expect(JSON.stringify(response.data)).not.toContain("D1_ERROR");
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", code: "DATABASE_ERROR" }),
    );
  });

  it("権限拒否（Forbidden）は 403 で、warn でログに残る", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = facilityErrorResponse(context, errorOf(FacilityErrorCode.Forbidden));

    expect(response.init?.status).toBe(403);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ level: "warn", code: "FACILITY_FORBIDDEN", userId: "usr_01" }),
    );
  });

  it("状態不整合（InvalidTransition）は 409 で、info でログに残る", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = facilityErrorResponse(context, errorOf(FacilityErrorCode.InvalidTransition));

    expect(response.init?.status).toBe(409);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info", code: "FACILITY_INVALID_TRANSITION" }),
    );
  });

  it("将来の予約が存在する（HasUpcomingReservations）は 409 で、info でログに残る", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = facilityErrorResponse(
      context,
      errorOf(FacilityErrorCode.HasUpcomingReservations),
    );

    expect(response.init?.status).toBe(409);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ level: "info", code: "FACILITY_HAS_UPCOMING_RESERVATIONS" }),
    );
  });

  it("写真ストレージエラー（PhotoStorageError）は 500 で、error でログに残る", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = facilityErrorResponse(context, errorOf(FacilityErrorCode.PhotoStorageError));

    expect(response.init?.status).toBe(500);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error", code: "FACILITY_PHOTO_STORAGE_ERROR" }),
    );
  });
});

describe("facilityActionErrors", () => {
  it("field が一致する入力欄にエラーが入る", () => {
    const result = facilityActionErrors(
      context,
      errorOf(FacilityErrorCode.InvalidInput, {
        field: FacilityField.Name,
        userMessage: "施設名は必須です。",
      }),
      { [FacilityField.Name]: "nameError" },
    );

    expect(result).toEqual({
      nameError: "施設名は必須です。",
      formError: null,
    });
  });

  it("field が未指定または表にない項目は formError に入る", () => {
    const result = facilityActionErrors(
      context,
      errorOf(FacilityErrorCode.InvalidTransition, {
        userMessage: "施設の状態が変わっています。",
      }),
    );

    expect(result).toEqual({
      formError: "施設の状態が変わっています。",
    });
  });

  it("userMessage がない場合は表の既定文言にフォールバックする", () => {
    const result = facilityActionErrors(context, errorOf(FacilityErrorCode.PhotoStorageError));

    expect(result).toEqual({
      formError: "写真を保存できませんでした。時間をおいて、もう一度お試しください。",
    });
  });
});
