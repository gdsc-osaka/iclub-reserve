import { count, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { groupCalendarFeedTable, groupMemberTable } from "~/db/schema";
import { useD1TestDb } from "../d1-test-db";
import { seedGroup, seedMember, seedUser } from "../d1-test-seeds";
import { createGroupCalendarFeedRepository } from "./group-calendar-feed-repo";

const testDb = useD1TestDb();

const USER_ID = "usr_feed_test";
const GROUP_ID = "grp_feed_test";
const MEMBERSHIP_ID = "mem_feed_test";

const T1 = new Date("2026-05-01T10:00:00.000Z");
const T2 = new Date("2026-05-01T12:00:00.000Z");

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: USER_ID, name: "テストユーザー", email: "user@example.com" }),
    seedGroup({ id: GROUP_ID, name: "テスト団体" }),
    seedMember({ id: MEMBERSHIP_ID, groupId: GROUP_ID, userId: USER_ID }),
  );
});

describe("GroupCalendarFeedRepository (D1)", () => {
  it("二度の発行で 1 行のままであり、トークンは変わらない（onConflictDoNothing）", async () => {
    const repo = createGroupCalendarFeedRepository(testDb.db);

    // 1 回目の発行
    const firstResult = await repo.issue({
      membershipId: MEMBERSHIP_ID,
      token: "token_initial_123",
      now: T1,
    });
    expect(firstResult.isOk()).toBe(true);
    expect(firstResult._unsafeUnwrap().token).toBe("token_initial_123");

    // 2 回目の発行（別のトークンを渡しても既存の行が維持される）
    const secondResult = await repo.issue({
      membershipId: MEMBERSHIP_ID,
      token: "token_another_456",
      now: T2,
    });
    expect(secondResult.isOk()).toBe(true);
    expect(secondResult._unsafeUnwrap().token).toBe("token_initial_123");

    // DB の行数が 1 行であることを確認
    const rows = await testDb.db
      .select({ count: count() })
      .from(groupCalendarFeedTable)
      .where(eq(groupCalendarFeedTable.membershipId, MEMBERSHIP_ID));
    expect(rows[0].count).toBe(1);
  });

  it("作り直しによりトークンと updated_at が更新される（onConflictDoUpdate）", async () => {
    const repo = createGroupCalendarFeedRepository(testDb.db);

    // 初回発行
    await repo.issue({
      membershipId: MEMBERSHIP_ID,
      token: "token_first_123",
      now: T1,
    });

    // 作り直し
    const regenerated = await repo.regenerate({
      membershipId: MEMBERSHIP_ID,
      token: "token_second_456",
      now: T2,
    });

    expect(regenerated.isOk()).toBe(true);
    const feed = regenerated._unsafeUnwrap();
    expect(feed.token).toBe("token_second_456");
    expect(feed.updatedAt.getTime()).toBe(T2.getTime());

    // DB の行数は 1 行で、トークンが更新されていること
    const rows = await testDb.db
      .select()
      .from(groupCalendarFeedTable)
      .where(eq(groupCalendarFeedTable.membershipId, MEMBERSHIP_ID));
    expect(rows.length).toBe(1);
    expect(rows[0].token).toBe("token_second_456");
  });

  it("group_member の行を削除すると外部キー制約（ON DELETE CASCADE）により購読行も自動削除される", async () => {
    const repo = createGroupCalendarFeedRepository(testDb.db);

    // 購読行を発行
    await repo.issue({
      membershipId: MEMBERSHIP_ID,
      token: "token_cascade_123",
      now: T1,
    });

    // 所属行を削除
    await testDb.db.delete(groupMemberTable).where(eq(groupMemberTable.id, MEMBERSHIP_ID));

    // group_calendar_feed テーブルから自動的に削除されていること
    const rows = await testDb.db
      .select({ count: count() })
      .from(groupCalendarFeedTable)
      .where(eq(groupCalendarFeedTable.membershipId, MEMBERSHIP_ID));
    expect(rows[0].count).toBe(0);

    // リポジトリの読み取りも null を返すこと
    const result = await repo.findByMembershipId(MEMBERSHIP_ID);
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });
});
