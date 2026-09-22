import { eq } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";
import { groupMemberTable, groupTable } from "~/db/schema";
import {
  GroupErrorCode,
  GroupStatus,
  type CreateGroupInput,
  type Group,
  type GroupError,
  type GroupRepository,
  type UpdateGroupNameInput,
} from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import type { Database } from "../db";
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
      db.select().from(groupTable).where(eq(groupTable.id, id)).limit(1),
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
      db.update(groupTable).set({ name, updatedAt }).where(eq(groupTable.id, id)).returning(),
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

  const create = ({
    id,
    name,
    ownerUserId,
    membershipId,
    now,
  }: CreateGroupInput): ResultAsync<Group, GroupError> => {
    /*
     * 団体と初期管理者を 1 回の batch で同時に挿入する。
     *
     * 【1 往復にする理由】
     * Cloudflare D1 はネットワーク往復ごとにレイテンシとコストが生じるため、
     * 1 回の batch にまとめることで無駄な往復を削減する。
     *
     * 【トランザクション整合性】
     * D1 の batch は単一のトランザクションとして実行されるため、
     * 「団体だけが作成されて管理者が付かない」という不整合な状態は起こらない。
     *
     * 【実行順序】
     * group_member.group_id は group.id を参照する外部キーであるため、
     * 必ず groupTable の INSERT を先に実行する（逆順だと外部キー制約違反になる）。
     */
    const insertGroup = db
      .insert(groupTable)
      .values({
        id,
        name,
        status: GroupStatus.Pending,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const insertMember = db.insert(groupMemberTable).values({
      id: membershipId,
      groupId: id,
      userId: ownerUserId,
      role: MembershipRole.Admin,
      createdAt: now,
      updatedAt: now,
    });

    return ResultAsync.fromPromise(db.batch([insertGroup, insertMember]), databaseError).andThen(
      (results) => {
        // 1 文目（insertGroup）の RETURNING 結果を取り出す
        const insertedGroupRows = results[0];
        const row = insertedGroupRows.at(0);

        /*
         * INSERT ... RETURNING なので通常 row が undefined になることはないが、
         * 型の整合性担保および万が一の欠損時に安全にエラーを返す。
         */
        if (row === undefined) {
          return err(databaseError(new Error("作成された団体の行を取得できませんでした。")));
        }

        return ok(toGroup(row));
      },
    );
  };

  return { findById, updateName, create };
};
