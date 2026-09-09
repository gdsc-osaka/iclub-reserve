import type { BaseError } from "~/domain/error";

/**
 * 読み取り (Query) で起きるエラーの種類。
 *
 * 読み取りは集約ごとの都合を持たないので、エラーもドメインごとに分けず
 * この 1 種類にそろえている。詳しくは docs/adr/001-read-model-separation.md を参照。
 */
export const QueryErrorCode = {
  NotFound: "NOT_FOUND",
  Forbidden: "FORBIDDEN",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type QueryErrorCode = (typeof QueryErrorCode)[keyof typeof QueryErrorCode];

/** 読み取り (Query) が失敗したことを表すエラー。 */
export interface QueryError extends BaseError {
  readonly code: QueryErrorCode;
}
