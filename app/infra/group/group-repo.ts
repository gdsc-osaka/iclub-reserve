import { err, ok, ResultAsync } from "neverthrow";
import { organization } from "~/db/schema";
import { GroupErrorCode, type Group, type GroupError, type GroupRepository } from "~/domain/group";
import type { Database } from "../db";
import { eq } from "drizzle-orm";
import { toGroup } from "./group-converter";

export const createGroupRepository = (db: Database): GroupRepository => {
  const findById = (id: string): ResultAsync<Group, GroupError> =>
    ResultAsync.fromPromise(
      db.select().from(organization).where(eq(organization.id, id)).limit(1),
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

      return ok(toGroup(row));
    });

  return { findById };
};
