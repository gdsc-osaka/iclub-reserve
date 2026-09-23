import { err, ok, type Result } from "neverthrow";
import { FacilityErrorCode, FacilityField, type FacilityError } from "./index";

/** 施設名の最大文字数（INFO-002 / group-name.ts に準拠） */
export const FACILITY_NAME_MAX_LENGTH = 64;

/** 施設説明の最大文字数 */
export const FACILITY_DESCRIPTION_MAX_LENGTH = 1000;

/** Google Calendar ID の最大文字数 */
export const GOOGLE_CALENDAR_ID_MAX_LENGTH = 255;

/**
 * 施設名の誤りを表すエラーを作る。
 */
const invalidName = (message: string, userMessage: string): FacilityError => ({
  code: FacilityErrorCode.InvalidInput,
  field: FacilityField.Name,
  message,
  userMessage,
});

/**
 * 施設説明の誤りを表すエラーを作る。
 */
const invalidDescription = (message: string, userMessage: string): FacilityError => ({
  code: FacilityErrorCode.InvalidInput,
  field: FacilityField.Description,
  message,
  userMessage,
});

/**
 * Google Calendar ID の誤りを表すエラーを作る。
 */
const invalidGoogleCalendarId = (message: string, userMessage: string): FacilityError => ({
  code: FacilityErrorCode.InvalidInput,
  field: FacilityField.GoogleCalendarId,
  message,
  userMessage,
});

/**
 * 施設名の入力を検証する純粋関数。
 *
 * 【検証規則】
 * 1. 前後の空白を落とす（trim）。
 * 2. 空白除去後に空文字になった場合はエラー（必須入力）。
 * 3. 改行やタブを含んでいる場合はエラー（一覧や見出しのレイアウトが崩れるため）。
 * 4. 最大文字数（64文字）を超える場合はエラー（String.prototype.length で判定）。
 * 5. 上記を満たした場合は trim 済みの施設名を返す。
 */
export const validateFacilityName = (
  raw: string | null | undefined,
): Result<string, FacilityError> => {
  if (raw === null || raw === undefined) {
    return err(invalidName("施設名が送られていない。", "施設名を入力してください。"));
  }

  const trimmed = raw.trim();

  if (trimmed === "") {
    return err(invalidName("施設名が空である。", "施設名を入力してください。"));
  }

  if (/[\r\n\t]/.test(trimmed)) {
    return err(
      invalidName("施設名に改行かタブが含まれている。", "施設名に改行やタブは使えません。"),
    );
  }

  if (trimmed.length > FACILITY_NAME_MAX_LENGTH) {
    return err(
      invalidName(
        `施設名が ${FACILITY_NAME_MAX_LENGTH} 文字を超えている。`,
        `施設名は ${FACILITY_NAME_MAX_LENGTH} 文字以内で入力してください。`,
      ),
    );
  }

  return ok(trimmed);
};

/**
 * 施設説明の入力を検証する純粋関数。
 *
 * 【検証規則】
 * 1. 前後の空白を落とす（trim）。
 * 2. 未入力または空文字の場合は null を返す（任意項目）。
 * 3. 改行は許可する。
 * 4. 最大文字数（1000文字）を超える場合はエラー。
 * 5. 上記を満たした場合は trim 済みの説明文を返す。
 */
export const validateFacilityDescription = (
  raw: string | null | undefined,
): Result<string | null, FacilityError> => {
  if (raw === null || raw === undefined) {
    return ok(null);
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    return ok(null);
  }

  if (trimmed.length > FACILITY_DESCRIPTION_MAX_LENGTH) {
    return err(
      invalidDescription(
        `施設の説明が ${FACILITY_DESCRIPTION_MAX_LENGTH} 文字を超えている。`,
        `施設の説明は ${FACILITY_DESCRIPTION_MAX_LENGTH} 文字以内で入力してください。`,
      ),
    );
  }

  return ok(trimmed);
};

/**
 * Google Calendar ID の入力を検証する純粋関数。
 *
 * 【検証規則】
 * 1. 前後の空白を落とす（trim）。
 * 2. 未入力または空文字の場合は null を返す（任意項目）。
 * 3. 空白文字（スペース、タブ、改行等）を含む場合はエラー。
 * 4. '@' を含まない場合はエラー（カレンダーID形式チェック）。
 * 5. 最大文字数（255文字）を超える場合はエラー。
 * 6. 上記を満たした場合は trim 済みのカレンダーIDを返す。
 */
export const validateGoogleCalendarId = (
  raw: string | null | undefined,
): Result<string | null, FacilityError> => {
  if (raw === null || raw === undefined) {
    return ok(null);
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    return ok(null);
  }

  if (/\s/.test(trimmed)) {
    return err(
      invalidGoogleCalendarId(
        "Google Calendar ID に空白が含まれている。",
        "Google カレンダー ID に空白は含められません。",
      ),
    );
  }

  if (!trimmed.includes("@")) {
    return err(
      invalidGoogleCalendarId(
        "Google Calendar ID に @ が含まれていない。",
        "Google カレンダー ID の形式が正しくありません（@ を含めてください）。",
      ),
    );
  }

  if (trimmed.length > GOOGLE_CALENDAR_ID_MAX_LENGTH) {
    return err(
      invalidGoogleCalendarId(
        `Google Calendar ID が ${GOOGLE_CALENDAR_ID_MAX_LENGTH} 文字を超えている。`,
        `Google カレンダー ID は ${GOOGLE_CALENDAR_ID_MAX_LENGTH} 文字以内で入力してください。`,
      ),
    );
  }

  return ok(trimmed);
};

/**
 * Google Calendar ID からカレンダー購読用 URL（iCal形式）を生成する。
 *
 * ID が null または空文字の場合は null を返す。
 */
export const toCalendarUrl = (googleCalendarId: string | null): string | null => {
  if (googleCalendarId === null || googleCalendarId === "") {
    return null;
  }
  return `https://calendar.google.com/calendar/ical/${encodeURIComponent(googleCalendarId)}/public/basic.ics`;
};
