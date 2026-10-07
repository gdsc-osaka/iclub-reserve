/**
 * 団体一覧（SCR-008）の読み取りと、団体の状態の更新（UC-014）を、ローカルの本物の D1 に対して実行して確かめるテスト。
 *
 * 【なぜ実際に流すのか】
 * ユースケースのテストは Query と Repository を偽物に差し替えるので、SQL の誤りは素通りする。
 * 実際に、最初の実装ではメンバー数を相関サブクエリで数えており、Drizzle が列名から表名を省いたせいで
 * 内側の `id` が group_member.id を指し、どの団体も「メンバー 0 人」になっていた。
 * 型もテストも通っていたので、ここで数と並び順を実際の DB で押さえる。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GroupErrorCode, GroupStatus } from "~/domain/group";
import { useD1TestDb } from "../d1-test-db";

const testDb = useD1TestDb();
import { createUserGroupListQuery } from "../user/user-group-list-query";
import { createGroupRepository } from "./group-repo";
import { createGroupSearchQuery } from "./group-search-query";

beforeEach(async () => {
  const insertUserSql = `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`;
  const insertGroupSql = `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`;
  const insertMemberSql = `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`;

  await testDb.seed(
    [insertUserSql, "usr_taro", "太郎", "taro@ecs.osaka-u.ac.jp", 1, 0, 0, 0],
    [insertUserSql, "usr_hanako", "花子", "hanako@ecs.osaka-u.ac.jp", 1, 0, 0, 0],
    [insertUserSql, "usr_jiro", "次郎", "jiro@ecs.osaka-u.ac.jp", 1, 0, 0, 0],
    [insertGroupSql, "grp_robotics", "ロボティクス", "enabled", 1000, 1000],
    [insertGroupSql, "grp_ai", "AI 班", "pending", 3000, 3000],
    [insertGroupSql, "grp_band", "軽音", "pending", 2000, 2000],
    [insertGroupSql, "grp_empty", "休止中のグループ", "disabled", 4000, 4000],
    [insertMemberSql, "mem_1", "grp_robotics", "usr_taro", "admin", 0, 0],
    [insertMemberSql, "mem_2", "grp_robotics", "usr_hanako", "member", 0, 0],
    [insertMemberSql, "mem_3", "grp_robotics", "usr_jiro", "member", 0, 0],
    [insertMemberSql, "mem_4", "grp_ai", "usr_taro", "member", 0, 0],
    [insertMemberSql, "mem_5", "grp_band", "usr_hanako", "admin", 0, 0],
  );
});
describe("所属団体の一覧（createUserGroupListQuery）", () => {
  it("自分の所属だけでなく、その団体のメンバー全員を数える", async () => {
    const result = await createUserGroupListQuery(testDb.db).findByUserId("usr_taro");

    expect(result._unsafeUnwrap().map(({ id, memberCount }) => ({ id, memberCount }))).toEqual([
      // 団体名の昇順（"AI 研究会" < "ロボット部"）
      { id: "grp_ai", memberCount: 1 },
      { id: "grp_robotics", memberCount: 3 },
    ]);
  });
});

describe("事務局向けの団体一覧（createGroupSearchQuery）", () => {
  it("すべての状態を出すときは団体名の順に並べ、メンバーが 0 人の団体も落とさない", async () => {
    const result = await createGroupSearchQuery(testDb.db).findList({ status: null });

    // SQLite の既定の比較は UTF-8 のバイト順なので、英字 → カタカナ → 漢字の順になる
    expect(result._unsafeUnwrap().map(({ id, memberCount }) => ({ id, memberCount }))).toEqual([
      { id: "grp_ai", memberCount: 1 },
      { id: "grp_robotics", memberCount: 3 },
      { id: "grp_empty", memberCount: 0 },
      { id: "grp_band", memberCount: 1 },
    ]);
  });

  it("承認待ちだけを出すときは、待たせている順（作成日時の昇順）に並べる", async () => {
    const result = await createGroupSearchQuery(testDb.db).findList({
      status: GroupStatus.Pending,
    });

    expect(result._unsafeUnwrap().map(({ id }) => id)).toEqual(["grp_band", "grp_ai"]);
  });

  it("状態ごとの件数を数え、1 件も無い状態は 0 にする", async () => {
    await testDb.seed([`UPDATE "group" SET status = 'pending' WHERE id = 'grp_empty'`]);

    const result = await createGroupSearchQuery(testDb.db).countByStatus();

    expect(result._unsafeUnwrap()).toEqual({
      [GroupStatus.Pending]: 3,
      [GroupStatus.Enabled]: 1,
      [GroupStatus.Disabled]: 0,
    });
  });
});

describe("団体の状態の更新（GroupRepository.updateStatus）", () => {
  const readStatus = async (id: string) =>
    (
      await testDb.d1
        .prepare(`SELECT status FROM "group" WHERE id = ?`)
        .bind(id)
        .first<{ status: string }>()
    )?.status;

  it("今の状態が from と一致すれば、to に変える", async () => {
    const result = await createGroupRepository(testDb.db).updateStatus({
      id: "grp_ai",
      from: GroupStatus.Pending,
      to: GroupStatus.Enabled,
      updatedAt: new Date(5_000),
    });

    expect(result._unsafeUnwrap().status).toBe(GroupStatus.Enabled);
    expect(await readStatus("grp_ai")).toBe(GroupStatus.Enabled);
  });

  it("先に別の事務局が状態を変えていたら InvalidTransition を返し、上書きしない", async () => {
    // 画面を開いた時点では pending だったが、そのあと別の事務局が無効にした
    await testDb.seed([`UPDATE "group" SET status = 'disabled' WHERE id = 'grp_ai'`]);

    const result = await createGroupRepository(testDb.db).updateStatus({
      id: "grp_ai",
      from: GroupStatus.Pending,
      to: GroupStatus.Enabled,
      updatedAt: new Date(5_000),
    });

    expect(result._unsafeUnwrapErr().code).toBe(GroupErrorCode.InvalidTransition);
    expect(await readStatus("grp_ai")).toBe(GroupStatus.Disabled);
  });
});
