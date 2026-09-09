import { and, eq } from "drizzle-orm";
import { ok, ResultAsync } from "neverthrow";

import { member } from "~/db/schema";
import {
  MembershipErrorCode,
  type Membership,
  type MembershipError,
  type MembershipRepository,
} from "~/domain/membership";
import type { Database } from "../db";
import { toMembership } from "./membership-converter";

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

  return { findByGroupAndUser };
};
