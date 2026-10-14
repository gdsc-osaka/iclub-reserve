import { okAsync, errAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import { MembershipRole } from "~/domain/membership";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { UserInvitationItem, UserInvitationsQuery } from "~/query/group/user-invitations";
import { listMyInvitationsUseCase } from "./list-my-invitations";

describe("listMyInvitationsUseCase", () => {
  it("メールアドレスを小文字・trim に正規化してクエリを呼ぶ", async () => {
    const mockItems: UserInvitationItem[] = [
      {
        id: "inv_1",
        groupId: "grp_1",
        groupName: "テスト団体",
        role: MembershipRole.Member,
        expiresAt: new Date("2026-10-25T10:00:00Z"),
        createdAt: new Date("2026-10-20T10:00:00Z"),
      },
    ];

    const mockQuery: UserInvitationsQuery = {
      findPendingInvitationsForEmail: (email, now) => {
        expect(email).toBe("user@example.com");
        expect(now.toISOString()).toBe("2026-10-20T12:00:00.000Z");
        return okAsync(mockItems);
      },
    };

    const result = await listMyInvitationsUseCase(
      { userInvitationsQuery: mockQuery },
      {
        actorEmail: "  User@EXAMPLE.com  ",
        now: new Date("2026-10-20T12:00:00.000Z"),
      },
    );

    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;
    expect(result.value).toEqual(mockItems);
  });

  it("クエリエラーをそのまま返す", async () => {
    const mockError: QueryError = {
      code: QueryErrorCode.DatabaseError,
      message: "Database error",
    };

    const mockQuery: UserInvitationsQuery = {
      findPendingInvitationsForEmail: () => errAsync(mockError),
    };

    const result = await listMyInvitationsUseCase(
      { userInvitationsQuery: mockQuery },
      { actorEmail: "user@example.com", now: new Date() },
    );

    expect(result.isErr()).toBe(true);
    if (!result.isErr()) return;
    expect(result.error).toEqual(mockError);
  });
});
