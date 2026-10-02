import { QueryErrorCode, queryErrorKind, type QueryError } from "~/query/error";

import {
  logDomainError,
  toErrorResponse,
  type ErrorContext,
  type ErrorTables,
  type ErrorView,
} from "./error-response.server";

/**
 * 読み取り（Query）の失敗を、利用者にどう見せるかの表（ADR-004 決定 5）。
 *
 * Query は集約をまたぐので（ADR-001）、何が見つからなかったのかをこの表は知らない。
 * 文言が「団体」「予約」のように名指しできないのはそのためである。
 * 画面ごとの具体的な案内は、各ルートの ErrorBoundary が status を見て出している。
 */
export const queryErrorView: Record<QueryErrorCode, ErrorView> = {
  [QueryErrorCode.NotFound]: { message: "表示する内容が見つかりません。" },
  [QueryErrorCode.Forbidden]: { message: "この画面を表示する権限がありません。" },
  [QueryErrorCode.DatabaseError]: {
    message: "読み込めませんでした。時間をおいて、もう一度お試しください。",
  },
};

const queryErrorTables: ErrorTables<QueryErrorCode> = {
  kindOf: queryErrorKind,
  viewOf: queryErrorView,
};

/**
 * 読み取りのユースケースが失敗したときに、loader から投げる応答を作る。
 *
 * Query は読み取りだけなので、action 用の関数は無い。
 *
 * @example
 * throw queryErrorResponse({ where: "reservations.loader", userId: user.id }, result.error);
 */
export const queryErrorResponse = (context: ErrorContext, error: QueryError) =>
  toErrorResponse(queryErrorTables, context, error);

/**
 * 読み取りの失敗をログにだけ残す。応答は作らない。
 *
 * 一部が読めなくても画面は開けるようにする loader（ダッシュボード）のためのもの。
 * 画面を続けるかどうかは画面が決めてよいが、失敗を残すかどうかは画面に決めさせない。
 *
 * @example
 * if (result.isErr()) {
 *   logQueryError({ where: "home.loader", userId: user.id }, result.error);
 *   return { groups: [], isGroupsUnavailable: true };
 * }
 */
export const logQueryError = (context: ErrorContext, error: QueryError): void =>
  logDomainError(queryErrorTables, context, error);
