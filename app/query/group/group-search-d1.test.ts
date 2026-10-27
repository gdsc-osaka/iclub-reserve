/**
 * 事務局向けの全団体の一覧（findGroupSearchList・countGroupsByStatus）を、ローカルの本物の D1 に対して確かめるテスト。
 *
 * メンバー数の数え方は、型もテストも通ったまま、どの団体も「メンバー 0 人」になっていたことがある
 * （`app/infra/group/member-count.ts`）。数と並び順は、ここで実際の DB で押さえる。
 */
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { useD1TestDb } from "~/infra/d1-test-db";
import { seedGroup, seedMember, seedUser } from "~/infra/d1-test-seeds";
import { QueryErrorCode } from "../error";
import { countGroupsByStatus, findGroupSearchList } from "./group-search";

const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: "usr_taro", name: "太郎", email: "taro@ecs.osaka-u.ac.jp" }),
    seedUser({ id: "usr_hanako", name: "花子", email: "hanako@ecs.osaka-u.ac.jp" }),
    seedUser({ id: "usr_jiro", name: "次郎", email: "jiro@ecs.osaka-u.ac.jp" }),
    seedGroup({
      id: "grp_robotics",
      name: "ロボティクス",
      status: GroupStatus.Enabled,
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
    }),
    seedGroup({
      id: "grp_ai",
      name: "AI 班",
      status: GroupStatus.Pending,
      createdAt: new Date(3000),
      updatedAt: new Date(3000),
    }),
    seedGroup({
      id: "grp_band",
      name: "軽音",
      status: GroupStatus.Pending,
      createdAt: new Date(2000),
      updatedAt: new Date(2000),
    }),
    seedGroup({
      id: "grp_empty",
      name: "休止中のグループ",
      status: GroupStatus.Disabled,
      createdAt: new Date(4000),
      updatedAt: new Date(4000),
    }),
    seedMember({
      id: "mem_1",
      groupId: "grp_robotics",
      userId: "usr_taro",
      role: MembershipRole.Admin,
    }),
    seedMember({
      id: "mem_2",
      groupId: "grp_robotics",
      userId: "usr_hanako",
      role: MembershipRole.Member,
    }),
    seedMember({
      id: "mem_3",
      groupId: "grp_robotics",
      userId: "usr_jiro",
      role: MembershipRole.Member,
    }),
    seedMember({ id: "mem_4", groupId: "grp_ai", userId: "usr_taro", role: MembershipRole.Member }),
    seedMember({
      id: "mem_5",
      groupId: "grp_band",
      userId: "usr_hanako",
      role: MembershipRole.Admin,
    }),
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
