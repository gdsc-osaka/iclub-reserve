import { err, ok, ResultAsync } from "neverthrow";
import { groupTable, type Group } from "~/db/schema";
import { GroupErrorCode, type GroupError, type GroupRepository } from "~/domain/group";
import type { Database } from "../db";
import { eq } from "drizzle-orm";

export const createGroupRepository = (db: Database): GroupRepository => {
  const findById = (id: string): ResultAsync<Group, GroupError> =>
    ResultAsync.fromPromise(
      db.select().from(groupTable).where(eq(groupTable.id, id)).limit(1),
      (error): GroupError => {
        return {
          code: GroupErrorCode.DatabaseError,
          message: "Failed to query the database",
          cause: error,
        };
      },
    ).andThen((rows) => {
      const row = rows.at(0);

      if (row === undefined) {
        return err({
          code: GroupErrorCode.GroupNotFound,
          message: "Group not found",
        });
      }

      return ok(row);
    });

  return { findById };
};
