import { errAsync, type ResultAsync } from "neverthrow";

import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  AuditLogSearchFilter,
  AuditLogSearchQuery,
  AuditLogSearchResult,
} from "~/query/audit-log/audit-log-search";

export interface SearchAuditLogsDeps {
  readonly auditLogSearchQuery: AuditLogSearchQuery;
}

export interface SearchAuditLogsArgs {
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009 / COND-012(1)）。操作履歴全件の閲覧は事務局限定 */
  readonly isStaff: boolean;
  readonly filter: AuditLogSearchFilter;
  readonly page: number;
}

/**
 * 事務局向け操作履歴画面（SCR-018）のデータを取得するユースケース。
 *
 * 【認可と可視範囲】
 * 全件の操作履歴を閲覧できるのは事務局スタッフ（isStaff: true）のみ（COND-009・COND-012(1)）。
 * 一般利用者が開こうとした場合は、DB 問い合わせを行う前に即座に FORBIDDEN を返す。
 */
export const searchAuditLogsUseCase = (
  deps: SearchAuditLogsDeps,
  args: SearchAuditLogsArgs,
): ResultAsync<AuditLogSearchResult, QueryError> => {
  if (!args.isStaff) {
    return errAsync({
      code: QueryErrorCode.Forbidden,
      message: "事務局ではないユーザーが操作履歴を開こうとした。",
    });
  }

  return deps.auditLogSearchQuery.search(args.filter, args.page);
};
