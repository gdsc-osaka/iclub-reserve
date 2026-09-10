import { err, ok, ResultAsync } from "neverthrow";
import { member, organization } from "~/db/schema";
import {
  GroupErrorCode,
  type Group,
  type GroupError,
  type GroupMembership,
  type GroupRepository,
} from "~/domain/group";
import type { Database } from "../db";
import { asc, eq } from "drizzle-orm";
import { toMembershipRoles } from "../membership/membership-converter";
import { toGroup } from "./group-converter";

/** DB アクセスの失敗を、この層のエラーに包む。文言を 1 か所にまとめるためのもの。 */
const databaseError = (error: unknown): GroupError => ({
  code: GroupErrorCode.DatabaseError,
  message: "Failed to query the database",
  cause: error,
});

export const createGroupRepository = (db: Database): GroupRepository => {
  const findById = (id: string): ResultAsync<Group, GroupError> =>
    ResultAsync.fromPromise(
      db.select().from(organization).where(eq(organization.id, id)).limit(1),
      databaseError,
    ).andThen((rows) => {
      const row = rows.at(0);

      if (row === undefined) {
        return err({
          code: GroupErrorCode.GroupNotFound,
          message: "Group not found",
        });
      }

      return ok(toGroup(row));
    });

  /*
   * member と organization を 1 回の問い合わせで結合する。
   *
   * 「所属している ID を引いてから 1 件ずつグループを引く」書き方にすると、
   * 所属している団体の数だけ DB アクセスが増える（N+1 問題）。
   * D1 は 1 リクエストあたりの往復が重いので、ここは必ず結合で取る。
   */
  const findAllByMemberUserId = (
    userId: string,
  ): ResultAsync<readonly GroupMembership[], GroupError> =>
    ResultAsync.fromPromise(
      db
        .select({ organization, role: member.role })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(eq(member.userId, userId))
        .orderBy(asc(organization.name)),
      databaseError,
    ).map((rows) =>
      rows.map(
        (row): GroupMembership => ({
          group: toGroup(row.organization),
          roles: toMembershipRoles(row.role),
        }),
      ),
    );

  return { findById, findAllByMemberUserId };
};
