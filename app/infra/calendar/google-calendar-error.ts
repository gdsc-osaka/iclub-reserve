import { CalendarErrorCode, CalendarField, type CalendarError } from "~/domain/calendar";

/** Google API の標準エラーレスポンス形式 */
interface GoogleApiErrorBody {
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
    readonly status?: string;
    readonly errors?: readonly {
      readonly domain?: string;
      readonly reason?: string;
      readonly message?: string;
    }[];
    readonly details?: readonly {
      readonly reason?: string;
      readonly [key: string]: unknown;
    }[];
  };
}

/**
 * 403 エラーの本文からレート制限（クォータ超過）によるものかを判定する。
 *
 * Google Calendar API では、403 レスポンスに以下の reason が含まれる場合にレート制限とみなす。
 * - rateLimitExceeded
 * - userRateLimitExceeded
 * - quotaExceeded
 * - dailyLimitExceeded
 */
const isRateLimit403 = (body: unknown): boolean => {
  if (!body) return false;

  if (typeof body === "string") {
    return /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|dailyLimitExceeded/i.test(body);
  }

  if (typeof body === "object") {
    const errorObj = (body as GoogleApiErrorBody).error;
    if (errorObj?.errors && Array.isArray(errorObj.errors)) {
      for (const err of errorObj.errors) {
        if (
          err.reason &&
          [
            "rateLimitExceeded",
            "userRateLimitExceeded",
            "quotaExceeded",
            "dailyLimitExceeded",
          ].includes(err.reason)
        ) {
          return true;
        }
      }
    }
    if (errorObj?.details && Array.isArray(errorObj.details)) {
      for (const detail of errorObj.details) {
        if (
          typeof detail === "object" &&
          detail !== null &&
          "reason" in detail &&
          typeof detail.reason === "string" &&
          [
            "rateLimitExceeded",
            "userRateLimitExceeded",
            "quotaExceeded",
            "dailyLimitExceeded",
          ].includes(detail.reason)
        ) {
          return true;
        }
      }
    }
    if (typeof errorObj?.message === "string" && /rate\s*limit|quota/i.test(errorObj.message)) {
      return true;
    }
  }

  return false;
};

/**
 * HTTP レスポンスの status と body から CalendarError に分類する純粋関数。
 *
 * Google Calendar API のエラー分類をテストで固定できるように infra 層の純粋関数として置く（ADR-002 / smtp-error.ts と同等）。
 *
 * @param status HTTP ステータスコード（通信失敗時は 0 など）
 * @param body レスポンス本文（パース済みオブジェクトまたは文字列）
 * @param cause エラーの根本原因
 */
export const classifyGoogleCalendarError = (
  status: number,
  body?: unknown,
  cause?: unknown,
): CalendarError => {
  // 401 Unauthorized: 認証失敗（Service Account の秘密鍵やメールの誤りなど）
  if (status === 401) {
    return {
      code: CalendarErrorCode.AuthFailed,
      message: "Google Calendar の認証に失敗しました。",
      userMessage: "Google Calendar の認証に失敗しました。管理者に問い合わせてください。",
      cause,
    };
  }

  // 403 Forbidden: レート制限または権限不足
  if (status === 403) {
    if (isRateLimit403(body)) {
      return {
        code: CalendarErrorCode.RateLimited,
        message: "Google Calendar API のレート制限を超過しました。",
        cause,
      };
    }
    return {
      code: CalendarErrorCode.Forbidden,
      message: "Google Calendar の操作権限がありません。",
      userMessage:
        "Google Calendar への書き込み権限がありません。カレンダーの共有設定を確認してください。",
      field: CalendarField.GoogleCalendarId,
      cause,
    };
  }

  // 404 Not Found: カレンダーまたは予定が見つからない
  if (status === 404) {
    return {
      code: CalendarErrorCode.NotFound,
      message: "Google Calendar の予定またはカレンダーが見つかりません。",
      userMessage:
        "指定された Google カレンダーが見つかりません。カレンダー ID を確認してください。",
      field: CalendarField.GoogleCalendarId,
      cause,
    };
  }

  // 429 Too Many Requests: レート制限
  if (status === 429) {
    return {
      code: CalendarErrorCode.RateLimited,
      message: "Google Calendar API のリクエスト上限に達しました。",
      cause,
    };
  }

  // 5xx Server Error: サーバー側の一時的不調
  if (status >= 500 && status <= 599) {
    return {
      code: CalendarErrorCode.Unavailable,
      message: "Google Calendar サーバーが一時的に利用できません。",
      cause,
    };
  }

  // 通信エラー（status === 0 またはネットワーク断）
  if (status === 0) {
    return {
      code: CalendarErrorCode.Unavailable,
      message: "Google Calendar との通信に失敗しました。",
      cause,
    };
  }

  // その他の拒否（400 Bad Request, 409 Conflict など）
  return {
    code: CalendarErrorCode.Rejected,
    message: "Google Calendar API からリクエストが拒否されました。",
    cause,
  };
};
