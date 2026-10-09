import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import {
  CalendarErrorCode,
  type CalendarClient,
  type CalendarError,
  type CalendarWriteAccess,
} from "~/domain/calendar";
import { FacilityErrorCode, FacilityField } from "~/domain/facility";
import { ensureCalendarWritable } from "./facility-calendar";

describe("ensureCalendarWritable", () => {
  const googleCalendarId = "test@group.calendar.google.com";
  const calendarWriterEmail = "iclub-calendar-sync@example.iam.gserviceaccount.com";

  const createMockClient = (
    checkWriteAccessResult: CalendarWriteAccess | CalendarError,
    isOk = true,
  ): CalendarClient => ({
    checkWriteAccess: () =>
      isOk
        ? okAsync(checkWriteAccessResult as CalendarWriteAccess)
        : errAsync(checkWriteAccessResult as CalendarError),
    upsertEvent: () => okAsync(null),
    deleteEvent: () => okAsync(null),
    listManagedEvents: () => okAsync([]),
  });

  it("writable の場合は ok(null) を返す", async () => {
    const calendarClient = createMockClient("writable");

    const result = await ensureCalendarWritable({
      calendarClient,
      googleCalendarId,
      calendarWriterEmail,
    });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("not_writable の場合は CalendarNotWritable を返し、メールアドレスを含む案内文にする", async () => {
    const calendarClient = createMockClient("not_writable");

    const result = await ensureCalendarWritable({
      calendarClient,
      googleCalendarId,
      calendarWriterEmail,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.CalendarNotWritable);
    expect(error.field).toBe(FacilityField.GoogleCalendarId);
    expect(error.userMessage).toContain(calendarWriterEmail);
    expect(error.userMessage).toContain("「予定の変更」の権限を付けてから");
    // ログ用メッセージに利用者が入力した Calendar ID を埋め込まない
    expect(error.message).not.toContain(googleCalendarId);
  });

  it("not_writable かつメールアドレスが null の場合はアドレス抜きの案内文にする", async () => {
    const calendarClient = createMockClient("not_writable");

    const result = await ensureCalendarWritable({
      calendarClient,
      googleCalendarId,
      calendarWriterEmail: null,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.CalendarNotWritable);
    expect(error.userMessage).toBe(
      "このカレンダーにシステムが予定を書き込めません。Google カレンダーの共有設定で「予定の変更」の権限を付けてから、もう一度保存してください。",
    );
  });

  it("not_found の場合も CalendarNotWritable を返す", async () => {
    const calendarClient = createMockClient("not_found");

    const result = await ensureCalendarWritable({
      calendarClient,
      googleCalendarId,
      calendarWriterEmail,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.CalendarNotWritable);
    expect(error.field).toBe(FacilityField.GoogleCalendarId);
  });

  it("再試行可能なエラー（Unavailable）の場合は CalendarUnavailable を返す", async () => {
    const calendarClient = createMockClient(
      { code: CalendarErrorCode.Unavailable, message: "503 Service Unavailable" },
      false,
    );

    const result = await ensureCalendarWritable({
      calendarClient,
      googleCalendarId,
      calendarWriterEmail,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.CalendarUnavailable);
    expect(error.field).toBe(FacilityField.GoogleCalendarId);
  });

  it("再試行可能なエラー（RateLimited）の場合は CalendarUnavailable を返す", async () => {
    const calendarClient = createMockClient(
      { code: CalendarErrorCode.RateLimited, message: "Rate limit exceeded" },
      false,
    );

    const result = await ensureCalendarWritable({
      calendarClient,
      googleCalendarId,
      calendarWriterEmail,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.CalendarUnavailable);
  });

  it("設定の誤り（AuthFailed）の場合は CalendarSystemError を返す", async () => {
    const calendarClient = createMockClient(
      { code: CalendarErrorCode.AuthFailed, message: "Invalid credentials" },
      false,
    );

    const result = await ensureCalendarWritable({
      calendarClient,
      googleCalendarId,
      calendarWriterEmail,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.CalendarSystemError);
    expect(error.field).toBe(FacilityField.GoogleCalendarId);
  });
});
