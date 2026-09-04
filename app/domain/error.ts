/**
 * 各ドメインのベースとなるエラー型
 */
export interface BaseError {
  readonly message: string;
  /** 元となった例外。ログ出力用で、クライアントには返さない */
  readonly cause?: unknown;
}
