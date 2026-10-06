import { asc, eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { staffInvitationTable, user } from "~/db/schema";
import { InvitationStatus } from "~/domain/invitation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { StaffManagementQuery, StaffManagementView } from "~/query/staff/staff-management";
import type { Database } from "../db";

/**
 * Cloudflare D1 (Drizzle) を使った StaffManagementQuery の実装。
 *
 * 事務局スタッフ一覧（氏名昇順、同名は ID 昇順）と、
 * 承諾待ちの事務局招待一覧（有効期限昇順、同期限は ID 昇順）を取得する。
 */
export const createStaffManagementQuery = (db: Database): StaffManagementQuery => ({
  get: () =>
    ResultAsync.fromPromise(
      Promise.all([
        db
          .select({
            userId: user.id,
            name: user.name,
            email: user.email,
          })
          .from(user)
          .where(eq(user.is_staff, true))
          .orderBy(asc(user.name), asc(user.id)),
        db
          .select({
            id: staffInvitationTable.id,
            email: staffInvitationTable.email,
            expiresAt: staffInvitationTable.expiresAt,
          })
          .from(staffInvitationTable)
          .where(eq(staffInvitationTable.status, InvitationStatus.Pending))
          .orderBy(asc(staffInvitationTable.expiresAt), asc(staffInvitationTable.id)),
      ]),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "事務局管理画面データの取得に失敗しました。",
        cause: error,
      }),
    ).map(([members, pendingInvitations]): StaffManagementView => ({
      members,
      pendingInvitations,
    })),
});
