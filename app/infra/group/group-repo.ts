import { err, ok, ResultAsync } from "neverthrow";
import { organization } from "~/db/schema";
import {
  GroupErrorCode,
  type Group,
  type GroupError,
  type GroupRepository,
  type UpdateGroupNameInput,
} from "~/domain/group";
import type { Database } from "../db";
import { eq } from "drizzle-orm";
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

  const updateName = ({
    id,
    name,
    updatedAt,
  }: UpdateGroupNameInput): ResultAsync<Group, GroupError> =>
    ResultAsync.fromPromise(
      db.update(organization).set({ name, updatedAt }).where(eq(organization.id, id)).returning(),
      databaseError,
    ).andThen((rows) => {
      const row = rows.at(0);

      /*
       * 更新件数が 0 件の場合は指定された ID の団体が存在しなかったことを示す。
       * 存在確認の SELECT を事前に投げずに直接 UPDATE ... RETURNING を実行することで、
       * D1 との往復を 1 回で済ませている（Edge 環境でのネットワーク遅延削減）。
       */
      if (row === undefined) {
        return err({
          code: GroupErrorCode.GroupNotFound,
          message: "Group not found",
        });
      }

      return ok(toGroup(row));
    });

  return { findById, updateName };
};
