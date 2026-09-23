import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FacilityErrorCode, type FacilityError } from "~/domain/facility";

import { facilityErrorResponse } from "./facility-error.server";

const context = { where: "facility.test", userId: "usr_01" };

const errorOf = (code: FacilityErrorCode, extra: Partial<FacilityError> = {}): FacilityError => ({
  code,
  message: "ログ用の説明",
  ...extra,
});

beforeEach(() => {
  // ログの中身は個別のテストで確かめる。ここでは出力を黙らせるだけ
  vi.spyOn(console, "info").mockImplementation(() => {});
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
    // これまでは本当の障害と見分けがつかなくなるため残していなかった（ADR-004 コンテキストの 6）
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
});
