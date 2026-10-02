import { count } from "drizzle-orm";

import { groupMemberTable } from "~/db/schema";
import type { Database } from "../db";

/**
 * 団体ごとのメンバー数を数える派生テーブル（SCR-008 の 2 つの一覧で使う）。
 *
 * 使う側は `leftJoin(memberCounts, eq(memberCounts.groupId, groupTable.id))` で団体に付ける。
 * メンバーが 0 人の団体は派生テーブルに行が無く、列が null になるので、0 に読み替えること。
 * 団体ごとに数え直す（N+1）書き方にはせず、一覧と同じ 1 回の問い合わせで取る。
 *
 * 【相関サブクエリを sql`` で書かない理由】
 * Drizzle は、結合の無い select では列名から表名を省いて組み立てる。
 * `sql` で `(select count(*) from group_member where group_id = id)` と書くと、
 * 内側の `id` が group.id ではなく group_member.id を指してしまい、どの団体も 0 人になる。
 * 派生テーブルにすれば、Drizzle が表名つきで組み立てるので取り違えが起きない。
 */
export const memberCountsByGroup = (db: Database) =>
  db
    .select({ groupId: groupMemberTable.groupId, memberCount: count().as("member_count") })
    .from(groupMemberTable)
    .groupBy(groupMemberTable.groupId)
    .as("member_counts");
