import { describe, expect, it } from "vitest";
import { CalendarErrorCode, CalendarField, isRetryableCalendarError } from "~/domain/calendar";
import { classifyGoogleCalendarError } from "./google-calendar-error";

describe("classifyGoogleCalendarError", () => {
  it("401 は AuthFailed に分類され、再試行不可である", () => {
    const error = classifyGoogleCalendarError(401, { error: { message: "Invalid Credentials" } });
    expect(error.code).toBe(CalendarErrorCode.AuthFailed);
    expect(isRetryableCalendarError(error)).toBe(false);
  });

  describe("403 Forbidden の分類", () => {
    it("rateLimitExceeded は RateLimited に分類され、再試行可である", () => {
      const body = {
        error: {
          code: 403,
          message: "Rate Limit Exceeded",
          errors: [
            { domain: "usageLimits", reason: "rateLimitExceeded", message: "Rate Limit Exceeded" },
          ],
        },
      };
      const error = classifyGoogleCalendarError(403, body);
      expect(error.code).toBe(CalendarErrorCode.RateLimited);
      expect(isRetryableCalendarError(error)).toBe(true);
    });

    it("userRateLimitExceeded は RateLimited に分類され、再試行可である", () => {
      const body = {
        error: {
          code: 403,
          message: "User Rate Limit Exceeded",
          errors: [
            {
              domain: "usageLimits",
              reason: "userRateLimitExceeded",
              message: "User Rate Limit Exceeded",
            },
          ],
        },
      };
      const error = classifyGoogleCalendarError(403, body);
      expect(error.code).toBe(CalendarErrorCode.RateLimited);
      expect(isRetryableCalendarError(error)).toBe(true);
    });

    it("quotaExceeded は RateLimited に分類され、再試行可である", () => {
      const body = {
        error: {
          code: 403,
          errors: [{ reason: "quotaExceeded" }],
        },
      };
      const error = classifyGoogleCalendarError(403, body);
      expect(error.code).toBe(CalendarErrorCode.RateLimited);
      expect(isRetryableCalendarError(error)).toBe(true);
    });

    it("文字列の body に rateLimitExceeded が含まれる場合も RateLimited に分類される", () => {
      const error = classifyGoogleCalendarError(403, "User rateLimitExceeded occurred");
      expect(error.code).toBe(CalendarErrorCode.RateLimited);
      expect(isRetryableCalendarError(error)).toBe(true);
    });

    it("権限不足（insufficientPermissions 等）は Forbidden に分類され、再試行不可である", () => {
      const body = {
        error: {
          code: 403,
          message: "The user must have writer or owner access to the calendar.",
          errors: [{ domain: "global", reason: "insufficientPermissions", message: "Forbidden" }],
        },
      };
      const error = classifyGoogleCalendarError(403, body);
      expect(error.code).toBe(CalendarErrorCode.Forbidden);
      expect(error.field).toBe(CalendarField.GoogleCalendarId);
      expect(isRetryableCalendarError(error)).toBe(false);
    });

    it("errors 配列が無い一般的な 403 も Forbidden に分類される", () => {
      const error = classifyGoogleCalendarError(403, { error: { message: "Access denied" } });
      expect(error.code).toBe(CalendarErrorCode.Forbidden);
      expect(isRetryableCalendarError(error)).toBe(false);
    });
  });

  it("404 は NotFound に分類され、再試行不可である", () => {
    const error = classifyGoogleCalendarError(404, { error: { message: "Not Found" } });
    expect(error.code).toBe(CalendarErrorCode.NotFound);
    expect(error.field).toBe(CalendarField.GoogleCalendarId);
    expect(isRetryableCalendarError(error)).toBe(false);
  });

  it("429 は RateLimited に分類され、再試行可である", () => {
    const error = classifyGoogleCalendarError(429, "Too Many Requests");
    expect(error.code).toBe(CalendarErrorCode.RateLimited);
    expect(isRetryableCalendarError(error)).toBe(true);
  });

  it("500 / 502 / 503 / 504 は Unavailable に分類され、再試行可である", () => {
    for (const status of [500, 502, 503, 504]) {
      const error = classifyGoogleCalendarError(status, { error: { message: "Server error" } });
      expect(error.code).toBe(CalendarErrorCode.Unavailable);
      expect(isRetryableCalendarError(error)).toBe(true);
    }
  });

  it("status 0（通信途絶・タイムアウト）は Unavailable に分類され、再試行可である", () => {
    const error = classifyGoogleCalendarError(0, null, new TypeError("fetch failed"));
    expect(error.code).toBe(CalendarErrorCode.Unavailable);
    expect(isRetryableCalendarError(error)).toBe(true);
    expect(error.cause).toBeDefined();
  });

  it("400 Bad Request や 409 Conflict などのその他の 4xx は Rejected に分類され、再試行不可である", () => {
    for (const status of [400, 409, 422]) {
      const error = classifyGoogleCalendarError(status, { error: { message: "Bad Request" } });
      expect(error.code).toBe(CalendarErrorCode.Rejected);
      expect(isRetryableCalendarError(error)).toBe(false);
    }
  });
});
