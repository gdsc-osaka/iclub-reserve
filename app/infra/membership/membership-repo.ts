import { and, count, eq } from "drizzle-orm";
import { ok, ResultAsync } from "neverthrow";

import { groupMemberTable } from "~/db/schema";
import type { AuditLogDraft } from "~/domain/audit-log";
import {
  MembershipErrorCode,
  MembershipRole,
  type StoredMembership,
  type MembershipError,
  type MembershipRepository,
  type UpdateMembershipRoleInput,
} from "~/domain/membership";
import { guardedAuditLogInsert } from "../audit-log/audit-log-writes";
import type { Database } from "../db";
import { toMembership } from "./membership-converter";

export const createMembershipRepository = (db: Database): MembershipRepository => {
  const findByGroupAndUser = (
    groupId: string,
    userId: string,
  ): ResultAsync<StoredMembership | null, MembershipError> =>
    ResultAsync.fromPromise(
      db
        .select()
        .from(groupMemberTable)
        .where(and(eq(groupMemberTable.groupId, groupId), eq(groupMemberTable.userId, userId)))
        .limit(1),
      (error): MembershipError => ({
        code: MembershipErrorCode.DatabaseError,
        message: "メンバーシップの取得に失敗しました。",
        cause: error,
      }),
    ).andThen((rows) => {
      const row = rows.at(0);

      // 所属していないのは異常ではないので、エラーではなく null を返す。
      // 詳しくは MembershipRepository の説明を参照。
      if (row === undefined) {
        return ok(null);
      }

      return ok(toMembership(row));
    });

  const countAdmins = (groupId: string): ResultAsync<number, MembershipError> =>
    ResultAsync.fromPromise(
      /*
       * group_member テーブルには (group_id, user_id) の UNIQUE 制約があり、
       * 役割も COND-007 により単一値（"admin" または "member"）で保持されるため、
       * SQL の count() で一致する行数を直接数えるだけで正確な管理者人数が得られる。
       * 全行を取得して TypeScript 側で重複排除・集計する必要はなくなった。
       */
      db
        .select({ count: count() })
        .from(groupMemberTable)
        .where(
          and(
            eq(groupMemberTable.groupId, groupId),
            eq(groupMemberTable.role, MembershipRole.Admin),
          ),
        ),
      (error): MembershipError => ({
        code: MembershipErrorCode.DatabaseError,
        message: "管理者人数の取得に失敗しました。",
        cause: error,
      }),
    ).map((rows) => rows.at(0)?.count ?? 0);

  const updateRole = (
    input: UpdateMembershipRoleInput,
    auditLog: AuditLogDraft,
  ): ResultAsync<number, MembershipError> => {
    /*
     * where に groupId を必ず含める理由:
     * userId のみで条件を指定すると、他団体の所属行まで意図せず書き換えてしまう脆弱性・不具合につながる。
     * 更新対象を必ず指定された団体 (groupId) 内に閉じ込めるために含める。
     */
    const condition = and(
      eq(groupMemberTable.groupId, input.groupId),
      eq(groupMemberTable.userId, input.userId),
    );
    const auditStatement = guardedAuditLogInsert(db, auditLog, {
      from: groupMemberTable,
      where: condition,
    });
    const updateStatement = db
      .update(groupMemberTable)
      .set({ role: input.role, updatedAt: input.updatedAt })
      .where(condition)
      .returning({ id: groupMemberTable.id });

    return ResultAsync.fromPromise(
      db.batch([auditStatement, updateStatement]),
      (error): MembershipError => ({
        code: MembershipErrorCode.DatabaseError,
        message: "メンバーの役割の更新に失敗しました。",
        cause: error,
      }),
    ).map((results) => results[1].length);
  };

  const remove = (
    groupId: string,
    userId: string,
    auditLog: AuditLogDraft,
  ): ResultAsync<number, MembershipError> => {
    /*
     * where に groupId を必ず含める理由:
     * updateRole と同様、他団体のメンバー行を誤って削除することを確実に防ぎ、
     * 操作の対象を URL に含まれる団体に限定するため。
     */
    const condition = and(
      eq(groupMemberTable.groupId, groupId),
      eq(groupMemberTable.userId, userId),
    );
    const auditStatement = guardedAuditLogInsert(db, auditLog, {
      from: groupMemberTable,
      where: condition,
    });
    const deleteStatement = db
      .delete(groupMemberTable)
      .where(condition)
      .returning({ id: groupMemberTable.id });

    return ResultAsync.fromPromise(
      db.batch([auditStatement, deleteStatement]),
      (error): MembershipError => ({
        code: MembershipErrorCode.DatabaseError,
        message: "メンバーの削除に失敗しました。",
        cause: error,
      }),
    ).map((results) => results[1].length);
  };

  return { findByGroupAndUser, countAdmins, updateRole, remove };
};
