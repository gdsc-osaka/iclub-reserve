import { ErrorKind, type BaseError } from "~/domain/error";

/**
 * 読み取り (Query) の失敗を表すコード。
 *
 * ドメインごとに用意せず 1 つに束ねているのは、Query が集約をまたぐため。
 * 「グループの一覧に施設名も混ざる」ような読み取りで
 * GroupError と FacilityError のどちらを返すか決められない。
 *
 * 詳しくは docs/adr/001-read-model-separation.md を参照。
 */
export const QueryErrorCode = {
  NotFound: "NOT_FOUND",
  Forbidden: "FORBIDDEN",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type QueryErrorCode = (typeof QueryErrorCode)[keyof typeof QueryErrorCode];

export interface QueryError extends BaseError {
  readonly code: QueryErrorCode;
}

/**
 * 読み取りの失敗の分類（ADR-004 決定 3）。
 *
 * HTTP の status とログのレベルは、この表から決まる。
 */
export const queryErrorKind: Record<QueryErrorCode, ErrorKind> = {
  [QueryErrorCode.NotFound]: ErrorKind.NotFound,
  [QueryErrorCode.Forbidden]: ErrorKind.Forbidden,
  [QueryErrorCode.DatabaseError]: ErrorKind.Internal,
};
