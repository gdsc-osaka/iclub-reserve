/**
 * 各ドメインのベースとなるエラー型
 *
 * 文字列を 2 つに分けているのは、読む人が違うため（ADR-004 決定 2）。
 * `message` は開発者がログで読み、`userMessage` は利用者が画面で読む。
 * 1 つにまとめると、画面に出してよいかを変換する側が毎回判断することになる。
 */
export interface BaseError {
  /**
   * ログにだけ残す説明。画面には出さない。
   *
   * 利用者が入力した値を埋め込まないこと（ADR-004 決定 9）。ID は埋め込んでよい。
   */
  readonly message: string;
  /**
   * ドメインが利用者に向けて書いた文言。画面にそのまま出してよい。
   *
   * 無ければ、画面の側が表の既定の文言を出す。付け忘れても内部の事情が漏れることはなく、
   * 汎用の文言に落ちるだけで済む。
   */
  readonly userMessage?: string;
  /** 元となった例外。ログ出力用で、クライアントには返さない */
  readonly cause?: unknown;
}

/**
 * エラーコードの分類（ADR-004 決定 3）。
 *
 * HTTP の status・ログのレベル・`userMessage` を画面に出してよいかは、コードではなくこの分類で決まる。
 * 分類はエラーのフィールドには持たせず、各ドメインが「コード → 分類」の表を 1 枚持つ
 * （例: `groupErrorKind`）。フィールドにすると構築箇所ごとに書くことになり、
 * 同じコードに違う分類を書いても型が通ってしまう。
 */
export const ErrorKind = {
  /** 指したものが無い */
  NotFound: "not_found",
  /** 指したものはあるが、その人には許されていない */
  Forbidden: "forbidden",
  /** 入力された値が誤っている */
  InvalidInput: "invalid_input",
  /** 入力は正しいが、いまの状態と両立しない（予約の重なり・最後の管理者など） */
  Conflict: "conflict",
  /** 利用者の側では直せない失敗（DB の障害など）。内部の事情を画面に出さない */
  Internal: "internal",
} as const;
export type ErrorKind = (typeof ErrorKind)[keyof typeof ErrorKind];
