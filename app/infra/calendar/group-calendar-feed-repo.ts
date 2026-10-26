import { eq } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";

import { groupCalendarFeedTable } from "~/db/schema";
import type {
  GroupCalendarFeedInput,
  GroupCalendarFeedRepository,
  StoredGroupCalendarFeed,
} from "~/domain/calendar";
import { wrapError } from "~/domain/error";
import { GroupErrorCode, type GroupError } from "~/domain/group";
import type { Database } from "../db";

const databaseError = wrapError(
  GroupErrorCode.DatabaseError,
  "カレンダー購読テーブルを読み書きできなかった。",
);

const toStoredFeed = (
  row: typeof groupCalendarFeedTable.$inferSelect,
): StoredGroupCalendarFeed => ({
  id: row.id,
  membershipId: row.membershipId,
  token: row.token,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const createGroupCalendarFeedRepository = (db: Database): GroupCalendarFeedRepository => {
  const findByMembershipId = (
    membershipId: string,
  ): ResultAsync<StoredGroupCalendarFeed | null, GroupError> =>
    ResultAsync.fromPromise(
      db
        .select()
        .from(groupCalendarFeedTable)
        .where(eq(groupCalendarFeedTable.membershipId, membershipId))
        .limit(1),
      databaseError,
    ).map((rows) => {
      const row = rows.at(0);
      return row ? toStoredFeed(row) : null;
    });

  const issue = (input: GroupCalendarFeedInput): ResultAsync<StoredGroupCalendarFeed, GroupError> =>
    ResultAsync.fromPromise(
      db
        .insert(groupCalendarFeedTable)
        .values({
          membershipId: input.membershipId,
          token: input.token,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing({ target: groupCalendarFeedTable.membershipId })
        .returning(),
      databaseError,
    ).andThen((rows) => {
      const row = rows.at(0);
      if (row !== undefined) {
        return ok(toStoredFeed(row));
      }
      // すでに存在していた場合は既存の行を取得して返す
      return findByMembershipId(input.membershipId).andThen((existing) => {
        if (existing === null) {
          return err({
            code: GroupErrorCode.DatabaseError,
            message: "発行済みのカレンダー購読行を読み取れませんでした。",
          });
        }
        return ok(existing);
      });
    });

  const regenerate = (
    input: GroupCalendarFeedInput,
  ): ResultAsync<StoredGroupCalendarFeed, GroupError> =>
    ResultAsync.fromPromise(
      db
        .insert(groupCalendarFeedTable)
        .values({
          membershipId: input.membershipId,
          token: input.token,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: groupCalendarFeedTable.membershipId,
          set: {
            token: input.token,
            updatedAt: input.now,
          },
        })
        .returning(),
      databaseError,
    ).andThen((rows) => {
      const row = rows.at(0);
      if (row === undefined) {
        return err({
          code: GroupErrorCode.DatabaseError,
          message: "カレンダー購読の作り直し結果を取得できませんでした。",
        });
      }
      return ok(toStoredFeed(row));
    });

  return {
    findByMembershipId,
    issue,
    regenerate,
  };
};
