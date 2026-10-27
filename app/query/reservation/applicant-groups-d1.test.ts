/**
 * 申請元として選べる団体（`findApplicantGroups`）の読み取りを、ローカルの本物の D1 に対して実行して確かめるテスト。
 */
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { useD1TestDb } from "~/infra/d1-test-db";
import { seedGroup, seedMember, seedUser } from "~/infra/d1-test-seeds";
import { findApplicantGroups } from "./applicant-groups";

const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    seedUser({ id: "usr_taro", name: "太郎", email: "taro@ecs.osaka-u.ac.jp" }),
    seedUser({ id: "usr_hanako", name: "花子", email: "hanako@ecs.osaka-u.ac.jp" }),
    // 有効な団体（同名で ID 違い）
    seedGroup({
      id: "grp_robotics_2",
      name: "ロボティクス",
      status: GroupStatus.Enabled,
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
    }),
    seedGroup({
      id: "grp_robotics_1",
      name: "ロボティクス",
      status: GroupStatus.Enabled,
      createdAt: new Date(1000),
      updatedAt: new Date(1000),
    }),
    // 別の有効な団体（名前の昇順で前になるもの）
    seedGroup({
      id: "grp_ai",
      name: "AI 班",
      status: GroupStatus.Enabled,
      createdAt: new Date(3000),
      updatedAt: new Date(3000),
    }),
    // 承認待ちの団体
    seedGroup({
      id: "grp_pending",
      name: "承認待ち班",
      status: GroupStatus.Pending,
      createdAt: new Date(2000),
      updatedAt: new Date(2000),
    }),
    // 無効な団体
    seedGroup({
      id: "grp_disabled",
      name: "休止班",
      status: GroupStatus.Disabled,
      createdAt: new Date(4000),
      updatedAt: new Date(4000),
    }),
    // 太郎の所属
    seedMember({
      id: "mem_1",
      groupId: "grp_robotics_2",
      userId: "usr_taro",
      role: MembershipRole.Admin,
    }),
    seedMember({
      id: "mem_2",
      groupId: "grp_pending",
      userId: "usr_taro",
      role: MembershipRole.Member,
    }),
    seedMember({
      id: "mem_3",
      groupId: "grp_disabled",
      userId: "usr_taro",
      role: MembershipRole.Member,
    }),
    // 花子の所属
    seedMember({
      id: "mem_4",
      groupId: "grp_ai",
      userId: "usr_hanako",
      role: MembershipRole.Member,
    }),
    seedMember({
      id: "mem_5",
      groupId: "grp_robotics_1",
      userId: "usr_hanako",
      role: MembershipRole.Member,
    }),
  );
});

describe("findApplicantGroups", () => {
  it("memberUserId を渡すと、自分が所属している有効な団体だけを返す（承認待ち・無効は返らない、他人の所属も返らない）", async () => {
    const result = await findApplicantGroups(testDb.db, { memberUserId: "usr_taro" });

    expect(result._unsafeUnwrap()).toEqual([{ id: "grp_robotics_2", name: "ロボティクス" }]);
  });

  it("memberUserId が null なら、所属に関わらず有効な全団体を返す（承認待ち・無効は返らない）", async () => {
    const result = await findApplicantGroups(testDb.db, { memberUserId: null });

    expect(result._unsafeUnwrap()).toEqual([
      { id: "grp_ai", name: "AI 班" },
      { id: "grp_robotics_1", name: "ロボティクス" },
      { id: "grp_robotics_2", name: "ロボティクス" },
    ]);
  });

  it("団体名の昇順、同名は ID の昇順で並ぶ", async () => {
    // 花子は "AI 班" と "ロボティクス (grp_robotics_1)" に所属
    const result = await findApplicantGroups(testDb.db, { memberUserId: "usr_hanako" });

    expect(result._unsafeUnwrap()).toEqual([
      { id: "grp_ai", name: "AI 班" },
      { id: "grp_robotics_1", name: "ロボティクス" },
    ]);
  });
});
