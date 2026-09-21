import { and, eq } from "drizzle-orm";
import { ok, ResultAsync } from "neverthrow";

import { member } from "~/db/schema";
import {
  MembershipErrorCode,
  type Membership,
  type MembershipError,
  type MembershipRepository,
  type UpdateMembershipRoleInput,
} from "~/domain/membership";
import type { Database } from "../db";
import { countAdminUsers, toMembership } from "./membership-converter";

export const createMembershipRepository = (db: Database): MembershipRepository => {
  const findByGroupAndUser = (
    groupId: string,
    userId: string,
  ): ResultAsync<Membership | null, MembershipError> =>
    ResultAsync.fromPromise(
      db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, groupId), eq(member.userId, userId)))
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
       * SQL で count(*) ... where role = 'admin' と数えない理由:
       * Better Auth は複数の役割を "admin,member" のようなカンマ区切りの 1 つの文字列で持ちうるため、
       * SQL の等値比較では複数役割を持つ行を数え落としてしまう。
       * 役割文字列の解釈は toMembershipRoles ただ 1 か所に集約するのがこのコードベースの設計方針なので、
       * 団体の行を取り出して TypeScript 側で数える。
       * 1 つの団体に属するメンバー数は多くないため、これで性能上の問題にはならない。
       */
      db
        .select({ userId: member.userId, role: member.role })
        .from(member)
        .where(eq(member.organizationId, groupId)),
      (error): MembershipError => ({
        code: MembershipErrorCode.DatabaseError,
        message: "管理者人数の取得に失敗しました。",
        cause: error,
      }),
      // 行数ではなくユーザー単位で数える（理由は countAdminUsers の説明を参照）
    ).map(countAdminUsers);

  const updateRole = (input: UpdateMembershipRoleInput): ResultAsync<number, MembershipError> =>
    ResultAsync.fromPromise(
      db
        .update(member)
        .set({ role: input.role, updatedAt: input.updatedAt })
        /*
         * where に organizationId を必ず含める理由:
         * userId のみで条件を指定すると、他団体の所属行まで意図せず書き換えてしまう脆弱性・不具合につながる。
         * 更新対象を必ず指定された団体 (groupId) 内に閉じ込めるために含める。
         */
        .where(and(eq(member.organizationId, input.groupId), eq(member.userId, input.userId)))
        .returning({ id: member.id }),
      (error): MembershipError => ({
        code: MembershipErrorCode.DatabaseError,
        message: "メンバーの役割の更新に失敗しました。",
        cause: error,
      }),
    ).map((rows) => rows.length);

  const remove = (groupId: string, userId: string): ResultAsync<number, MembershipError> =>
    ResultAsync.fromPromise(
      db
        .delete(member)
        /*
         * where に organizationId を必ず含める理由:
         * updateRole と同様、他団体のメンバー行を誤って削除することを確実に防ぎ、
         * 操作の対象を URL に含まれる団体に限定するため。
         */
        .where(and(eq(member.organizationId, groupId), eq(member.userId, userId)))
        .returning({ id: member.id }),
      (error): MembershipError => ({
        code: MembershipErrorCode.DatabaseError,
        message: "メンバーの削除に失敗しました。",
        cause: error,
      }),
    ).map((rows) => rows.length);

  return { findByGroupAndUser, countAdmins, updateRole, remove };
};
