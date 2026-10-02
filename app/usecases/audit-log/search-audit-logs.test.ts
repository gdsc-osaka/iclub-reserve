import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { AuditLogTargetType } from "~/domain/audit-log";
import { QueryErrorCode } from "~/query/error";
import type {
  AuditLogSearchFilter,
  AuditLogSearchQuery,
  AuditLogSearchResult,
} from "~/query/audit-log/audit-log-search";
import { searchAuditLogsUseCase } from "./search-audit-logs";

const dummyFilter: AuditLogSearchFilter = {
  targetType: AuditLogTargetType.Reservation,
  groupId: "grp_1",
  actorId: "usr_1",
  occurredFrom: new Date("2026-01-01T00:00:00.000Z"),
  occurredBefore: new Date("2026-01-02T00:00:00.000Z"),
};

const dummyResult: AuditLogSearchResult = {
  items: [],
  hasNextPage: false,
  groups: [],
  actors: [],
  userNames: {},
  facilityNames: {},
};

describe("searchAuditLogsUseCase", () => {
  it("事務局でないユーザー（isStaff: false）の場合は Forbidden を返し、Query を呼ばない", async () => {
    const searchMock = vi.fn();
    const query: AuditLogSearchQuery = { search: searchMock };

    const result = await searchAuditLogsUseCase(
      { auditLogSearchQuery: query },
      {
        actorUserId: "usr_student",
        isStaff: false,
        filter: dummyFilter,
        page: 1,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      code: QueryErrorCode.Forbidden,
      message: "事務局ではないユーザーが操作履歴を開こうとした。",
    });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it("事務局ユーザー（isStaff: true）の場合は filter と page がそのまま Query に渡る", async () => {
    const searchMock = vi.fn().mockReturnValue(okAsync(dummyResult));
    const query: AuditLogSearchQuery = { search: searchMock };

    const result = await searchAuditLogsUseCase(
      { auditLogSearchQuery: query },
      {
        actorUserId: "usr_staff",
        isStaff: true,
        filter: dummyFilter,
        page: 2,
      },
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(dummyResult);
    expect(searchMock).toHaveBeenCalledWith(dummyFilter, 2);
  });

  it("Query が失敗した場合はそのエラーがそのまま返る", async () => {
    const queryError = {
      code: QueryErrorCode.DatabaseError,
      message: "DB接続失敗",
    };
    const searchMock = vi.fn().mockReturnValue(errAsync(queryError));
    const query: AuditLogSearchQuery = { search: searchMock };

    const result = await searchAuditLogsUseCase(
      { auditLogSearchQuery: query },
      {
        actorUserId: "usr_staff",
        isStaff: true,
        filter: dummyFilter,
        page: 1,
      },
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual(queryError);
  });
});
