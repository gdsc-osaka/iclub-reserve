/**
 * 所属団体の一覧（SCR-008、`findUserGroupList`）の読み取りを、ローカルの本物の D1 に対して実行して確かめるテスト。
 * 事務局向けの全団体の一覧は `app/query/group/group-search-d1.test.ts` で確かめる。
 *
 * 【なぜ実際に流すのか】
 * ユースケースのテストは Query と Repository を偽物に差し替えるので、SQL の誤りは素通りする。
 * 実際に、最初の実装ではメンバー数を相関サブクエリで数えており、Drizzle が列名から表名を省いたせいで
 * 内側の `id` が group_member.id を指し、どの団体も「メンバー 0 人」になっていた。
 * 型もテストも通っていたので、ここで数と並び順を実際の DB で押さえる。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { MembershipRole } from "~/domain/membership";
import { useD1TestDb } from "~/infra/d1-test-db";
import { findUserGroupList } from "./user-group-list";

const testDb = useD1TestDb();

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

describe("findUserGroupList", () => {
  it("自分が所属している団体だけを役割つきで返し、自分以外の所属（grp_band・grp_empty）は返さない、メンバー数は全員を数える", async () => {
    const result = await findUserGroupList(testDb.db, { actorUserId: "usr_taro" });

    expect(
      result._unsafeUnwrap().map(({ id, role, memberCount }) => ({ id, role, memberCount })),
    ).toEqual([
      // 団体名の昇順（"AI 班" < "ロボティクス"）
      { id: "grp_ai", role: MembershipRole.Member, memberCount: 1 },
      { id: "grp_robotics", role: MembershipRole.Admin, memberCount: 3 },
    ]);
  });

  it("1 件も所属していないときは空の配列を返す", async () => {
    const result = await findUserGroupList(testDb.db, { actorUserId: "usr_newcomer" });

    expect(result._unsafeUnwrap()).toEqual([]);
  });
});
