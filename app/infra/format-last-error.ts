/**
 * 送れなかったメール・同期できなかった予定の失敗を、表の `last_error` に残す 1 行の文字列にする
 * （例: `CALENDAR_FORBIDDEN: {"error":{"code":403,…}}`）。原因が無ければエラーコードだけにする。
 */
export const formatLastError = (error: {
  readonly code: string;
  readonly cause?: unknown;
}): string => {
  const cause = toCauseText(error.cause);
  return cause ? `${error.code}: ${cause}` : error.code;
};

/**
 * 原因（cause）を文字列にする。
 *
 * cause には例外（Error）のほか、応答の本文（文字列）や、本文を JSON として読んだオブジェクトが入る。
 * `String()` に任せると、オブジェクトは `[object Object]` になって中身が残らないので、JSON にする。
 */
const toCauseText = (cause: unknown): string => {
  if (!cause) {
    return "";
  }
  if (typeof cause === "string") {
    return cause;
  }
  if (cause instanceof Error) {
    return String(cause);
  }
  try {
    return JSON.stringify(cause) ?? "";
  } catch {
    // 循環した参照や BigInt を含むと JSON にできない
    return "（文字列にできない値）";
  }
};
