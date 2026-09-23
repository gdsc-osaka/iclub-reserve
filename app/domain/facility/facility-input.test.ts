import { describe, expect, it } from "vitest";
import {
  FACILITY_DESCRIPTION_MAX_LENGTH,
  FACILITY_NAME_MAX_LENGTH,
  GOOGLE_CALENDAR_ID_MAX_LENGTH,
  toCalendarUrl,
  validateFacilityDescription,
  validateFacilityName,
  validateGoogleCalendarId,
} from "./facility-input";
import { FacilityErrorCode, FacilityField } from "./index";

describe("validateFacilityName", () => {
  it("正常な施設名がそのまま ok で返る", () => {
    const result = validateFacilityName("吹田：3Dプリンター 積層タイプ");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("吹田：3Dプリンター 積層タイプ");
  });

  it("前後の空白がトリムされる", () => {
    const result = validateFacilityName("  吹田：3Dプリンター   ");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("吹田：3Dプリンター");
  });

  it.each([null, undefined])("未入力（%o）は InvalidInput になる", (raw) => {
    const result = validateFacilityName(raw);
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.Name);
    expect(error.userMessage).toBe("施設名を入力してください。");
  });

  it.each(["", "   ", "\t", "\n"])("空文字または空白のみ（%o）は InvalidInput になる", (raw) => {
    const result = validateFacilityName(raw);
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.Name);
    expect(error.userMessage).toBe("施設名を入力してください。");
  });

  it.each(["吹田\nプリンター", "吹田\r\nプリンター", "吹田\tプリンター"])(
    "改行やタブを含む名前（%o）は InvalidInput になる",
    (raw) => {
      const result = validateFacilityName(raw);
      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(FacilityErrorCode.InvalidInput);
      expect(error.field).toBe(FacilityField.Name);
      expect(error.userMessage).toBe("施設名に改行やタブは使えません。");
    },
  );

  it("上限ちょうど（64文字）の施設名は通る", () => {
    const exact = "あ".repeat(FACILITY_NAME_MAX_LENGTH);
    const result = validateFacilityName(exact);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(exact);
  });

  it("上限+1（65文字）の施設名は InvalidInput になる", () => {
    const over = "あ".repeat(FACILITY_NAME_MAX_LENGTH + 1);
    const result = validateFacilityName(over);
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.Name);
    expect(error.userMessage).toBe(
      `施設名は ${FACILITY_NAME_MAX_LENGTH} 文字以内で入力してください。`,
    );
  });
});

describe("validateFacilityDescription", () => {
  it("正常な説明文がそのまま ok で返る", () => {
    const result = validateFacilityDescription("利用時は講習の受講が必要です。");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("利用時は講習の受講が必要です。");
  });

  it("前後の空白がトリムされる", () => {
    const result = validateFacilityDescription("  説明文です  ");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("説明文です");
  });

  it.each([null, undefined, "", "   ", "\t"])("未入力や空白のみ（%o）は null が返る", (raw) => {
    const result = validateFacilityDescription(raw);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("改行を含む説明文は許可される", () => {
    const text = "1行目\n2行目\r\n3行目";
    const result = validateFacilityDescription(text);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(text);
  });

  it("上限ちょうど（1000文字）の説明文は通る", () => {
    const exact = "あ".repeat(FACILITY_DESCRIPTION_MAX_LENGTH);
    const result = validateFacilityDescription(exact);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(exact);
  });

  it("上限+1（1001文字）の説明文は InvalidInput になる", () => {
    const over = "あ".repeat(FACILITY_DESCRIPTION_MAX_LENGTH + 1);
    const result = validateFacilityDescription(over);
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.Description);
    expect(error.userMessage).toBe(
      `施設の説明は ${FACILITY_DESCRIPTION_MAX_LENGTH} 文字以内で入力してください。`,
    );
  });
});

describe("validateGoogleCalendarId", () => {
  it("正常な Google Calendar ID が通る", () => {
    const validId = "c_1880abc@resource.calendar.google.com";
    const result = validateGoogleCalendarId(validId);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(validId);
  });

  it("前後の空白がトリムされる", () => {
    const result = validateGoogleCalendarId("  test@group.calendar.google.com  ");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe("test@group.calendar.google.com");
  });

  it.each([null, undefined, "", "   ", "\t"])("未入力や空白のみ（%o）は null が返る", (raw) => {
    const result = validateGoogleCalendarId(raw);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  it.each(["test @google.com", "test\t@google.com", "test\n@google.com"])(
    "途中に空白を含む ID（%o）は InvalidInput になる",
    (raw) => {
      const result = validateGoogleCalendarId(raw);
      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.code).toBe(FacilityErrorCode.InvalidInput);
      expect(error.field).toBe(FacilityField.GoogleCalendarId);
      expect(error.userMessage).toBe("Google カレンダー ID に空白は含められません。");
    },
  );

  it("アットマーク（@）を含まない ID は InvalidInput になる", () => {
    const result = validateGoogleCalendarId("calendar-id-without-at");
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.GoogleCalendarId);
    expect(error.userMessage).toBe(
      "Google カレンダー ID の形式が正しくありません（@ を含めてください）。",
    );
  });

  it("上限ちょうど（255文字）の ID は通る", () => {
    // 254文字の 'a' + '@'
    const exact = "a".repeat(GOOGLE_CALENDAR_ID_MAX_LENGTH - 1) + "@";
    const result = validateGoogleCalendarId(exact);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBe(exact);
  });

  it("上限+1（256文字）の ID は InvalidInput になる", () => {
    const over = "a".repeat(GOOGLE_CALENDAR_ID_MAX_LENGTH) + "@";
    const result = validateGoogleCalendarId(over);
    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.InvalidInput);
    expect(error.field).toBe(FacilityField.GoogleCalendarId);
    expect(error.userMessage).toBe(
      `Google カレンダー ID は ${GOOGLE_CALENDAR_ID_MAX_LENGTH} 文字以内で入力してください。`,
    );
  });
});

describe("toCalendarUrl", () => {
  it("Google Calendar ID から正しいエンコード済み ical URL を生成する", () => {
    const id = "test+facility@resource.calendar.google.com";
    const url = toCalendarUrl(id);
    expect(url).toBe(
      "https://calendar.google.com/calendar/ical/test%2Bfacility%40resource.calendar.google.com/public/basic.ics",
    );
  });

  it.each([null, ""])("ID が %o のときは null を返す", (id) => {
    expect(toCalendarUrl(id)).toBeNull();
  });
});
