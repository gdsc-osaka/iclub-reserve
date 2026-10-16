/**
 * 事務局向けの全団体の一覧（findGroupSearchList・countGroupsByStatus）を、ローカルの本物の D1 に対して確かめるテスト。
 *
 * メンバー数の数え方は、型もテストも通ったまま、どの団体も「メンバー 0 人」になっていたことがある
 * （`app/infra/group/member-count.ts`）。数と並び順は、ここで実際の DB で押さえる。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GroupStatus } from "~/domain/group";
import { useD1TestDb } from "~/infra/d1-test-db";
import { QueryErrorCode } from "../error";
import { countGroupsByStatus, findGroupSearchList } from "./group-search";

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

describe("findGroupSearchList", () => {
  it("事務局でない人には Forbidden を返す（COND-009）", async () => {
    const result = await findGroupSearchList(testDb.db, { isStaff: false, status: null });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("すべての状態を出すときは団体名の順に並べ、メンバーが 0 人の団体も落とさない", async () => {
    const result = await findGroupSearchList(testDb.db, { isStaff: true, status: null });

    // SQLite の既定の比較は UTF-8 のバイト順なので、英字 → カタカナ → 漢字の順になる
    expect(result._unsafeUnwrap().map(({ id, memberCount }) => ({ id, memberCount }))).toEqual([
      { id: "grp_ai", memberCount: 1 },
      { id: "grp_robotics", memberCount: 3 },
      { id: "grp_empty", memberCount: 0 },
      { id: "grp_band", memberCount: 1 },
    ]);
  });

  it("承認待ちだけを出すときは、待たせている順（作成日時の昇順）に並べる", async () => {
    const result = await findGroupSearchList(testDb.db, {
      isStaff: true,
      status: GroupStatus.Pending,
    });

    expect(result._unsafeUnwrap().map(({ id }) => id)).toEqual(["grp_band", "grp_ai"]);
  });
});

describe("countGroupsByStatus", () => {
  it("事務局でない人には Forbidden を返す（COND-009）", async () => {
    const result = await countGroupsByStatus(testDb.db, { isStaff: false });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("状態ごとの件数を数え、1 件も無い状態は 0 にする", async () => {
    await testDb.seed([`UPDATE "group" SET status = 'pending' WHERE id = 'grp_empty'`]);

    const result = await countGroupsByStatus(testDb.db, { isStaff: true });

    expect(result._unsafeUnwrap()).toEqual({
      [GroupStatus.Pending]: 3,
      [GroupStatus.Enabled]: 1,
      [GroupStatus.Disabled]: 0,
    });
  });
});
