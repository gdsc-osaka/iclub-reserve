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
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { useD1TestDb } from "~/infra/d1-test-db";
import { seedGroup, seedMember, seedUser } from "~/infra/d1-test-seeds";
import { findUserGroupList } from "./user-group-list";

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
