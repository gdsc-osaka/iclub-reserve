/** ログのレベル。どれを使うかは失敗の分類で決まる（ADR-004 決定 9） */
export type LogLevel = "info" | "warn" | "error";

/**
 * 失敗 1 件分のログ。
 *
 * 文字列ではなくオブジェクトのまま出す。Workers Logs はオブジェクトで出したログの項目を索引するので、
 * コードごと・利用者ごとに絞り込んだり数えたりできるようになる。
 */
export interface FailureLog {
  /**
   * 項目にも入れておく。`console.warn` と `console.info` の違いで絞り込めるかは
   * Workers Logs の説明に書かれていないため、それに頼らずに済むようにする。
   */
  readonly level: LogLevel;
  /** どの処理で起きたか（例: `"groups.detail.loader"`）。ログを絞り込む目印 */
  readonly where: string;
  readonly code: string;
  /** エラーコードの分類（`ErrorKind`） */
  readonly kind: string;
  /** 操作した人。無いと、1 人の総当たりと大勢の打ち間違いがログ上で同じに見える */
  readonly userId: string;
  /** ログ用の説明。利用者が入力した値は含めないこと */
  readonly message: string;
  /** 元となった例外。画面には出さず、ここでだけ残す */
  readonly cause?: unknown;
}

/** cause をたどる深さの上限。循環した参照で止まらなくなるのを防ぐ */
const MAX_CAUSE_DEPTH = 5;

/**
 * cause を、JSON にしても中身が落ちない形に直す。
 *
 * `Error` の name・message・stack は列挙されないプロパティなので、
 * オブジェクトの中に入れたまま JSON にすると `{}` になり、stack が失われる。
 * Workers Logs がログのオブジェクトをどう直すかは説明に書かれていないため、
 * それに頼らず、ここで文字列の項目に直してから渡す。
 */
const toLoggable = (value: unknown, depth = 0): unknown => {
  if (depth >= MAX_CAUSE_DEPTH) {
    return "[深すぎるため省略]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      ...(value.cause === undefined ? {} : { cause: toLoggable(value.cause, depth + 1) }),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => toLoggable(item, depth + 1));
  }

  // ドメインのエラーは Error ではなく素のオブジェクトで、その cause に Error が入っている
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toLoggable(item, depth + 1)]),
    );
  }

  return value;
};

/**
 * 失敗をサーバー側のログに残す。
 *
 * どのレベルで残すかは呼ぶ側が決める。ドメインのエラーなら
 * `app/routes/_shared/error-response.server.ts` が分類から決めて呼ぶので、ルートから直接は呼ばない。
 * `wrangler.jsonc` の `observability` を有効にしてあるので、Cloudflare のダッシュボードから読める。
 */
export const logFailure = (log: FailureLog): void => {
  const { cause, ...rest } = log;
  console[log.level](cause === undefined ? rest : { ...rest, cause: toLoggable(cause) });
};
