/**
 * 承諾の 2 文を、本物の D1 に対して実行して確かめるテスト。
 *
 * 【なぜ文の形だけでなく実行結果まで見るのか】
 * `invitation-repo.test.ts` は生成される SQL の形を見るが、形が正しく見えても
 * 「どの行が書かれるか」は別の話である。実際に、2 文の条件が食い違っていた時期には
 * 「一度でも承諾された招待の ID を知っていれば、宛先が違う人でもメンバーになれる」
 * という不具合があり、形だけを見るテストでは素通りしていた。
 * 承諾は所属（＝権限）を与える操作なので、通る・通らないを実際の DB で押さえる。
 * 本番の `accept` と同じく、2 文を D1 の batch で流す。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { InvitationStatus, type AcceptInvitationInput } from "~/domain/invitation";
import { MembershipRole } from "~/domain/membership";
import { invitationAcceptStatements } from "./invitation-repo";
import { useD1TestDb } from "../d1-test-db";

const testDb = useD1TestDb();

const NOW = new Date("2026-04-01T10:00:00.000Z");
const NOT_EXPIRED = new Date("2026-04-03T10:00:00.000Z");
const ALREADY_EXPIRED = new Date("2026-03-30T10:00:00.000Z");

const INVITEE_EMAIL = "hanako@ecs.osaka-u.ac.jp";
const OTHER_EMAIL = "jiro@ecs.osaka-u.ac.jp";

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_inviter",
      "招待した管理者",
      "taro@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_invitee",
      "招待された人",
      INVITEE_EMAIL,
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_other",
      "招待されていない人",
      OTHER_EMAIL,
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_1",
      "テスト団体",
      "enabled",
      0,
      0,
    ],
  );
});

const insertInvitation = async (options: {
  readonly status: InvitationStatus;
  readonly email: string;
  readonly expiresAt: Date;
}) => {
  await testDb.seed([
    `INSERT INTO "group_invitation" (id, group_id, email, role, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?,?,?)`,
    "inv_1",
    "grp_1",
    options.email,
    MembershipRole.Admin,
    options.status,
    options.expiresAt.getTime(),
    0,
    "usr_inviter",
  ]);
};

const runAccept = async (input: AcceptInvitationInput): Promise<string | null> => {
  const statements = invitationAcceptStatements(testDb.db, input);
  const results = await testDb.db.batch([statements[0], statements[1]]);
  // acceptInvitation の結果 (UPDATE) は 2 番目 (インデックス 1)
  const accepted = results[1] as { groupId: string }[];
  return accepted.at(0)?.groupId ?? null;
};

const membersOf = async () =>
  (await testDb.d1.prepare(`SELECT user_id, role FROM "group_member" ORDER BY user_id`).all())
    .results;

const invitationStatusOf = async () =>
  (
    (await testDb.d1
      .prepare(`SELECT status FROM "group_invitation" WHERE id = 'inv_1'`)
      .first()) as { status: string }
  ).status;

const acceptAsInvitee: AcceptInvitationInput = {
  invitationId: "inv_1",
  email: INVITEE_EMAIL,
  userId: "usr_invitee",
  membershipId: "mem_new",
  now: NOW,
};
describe("承諾の 2 文を D1 で実行する", () => {
  it("承諾待ち・宛先本人・期限内なら、メンバーが作られ招待が accepted になる", async () => {
    await insertInvitation({
      status: InvitationStatus.Pending,
      email: INVITEE_EMAIL,
      expiresAt: NOT_EXPIRED,
    });

    expect(await runAccept(acceptAsInvitee)).toBe("grp_1");
    // 役割は招待の行から読むので、招待したときの役割がそのまま入る
    expect(await membersOf()).toEqual([{ user_id: "usr_invitee", role: MembershipRole.Admin }]);
    expect(await invitationStatusOf()).toBe(InvitationStatus.Accepted);
    expect((await testDb.d1.prepare("PRAGMA foreign_key_check").all()).results).toEqual([]);
  });

  it.each([
    ["取り消し済み", InvitationStatus.Canceled, NOT_EXPIRED],
    ["辞退済み", InvitationStatus.Rejected, NOT_EXPIRED],
    ["期限切れ", InvitationStatus.Pending, ALREADY_EXPIRED],
  ])("%s の招待では、メンバーが作られない", async (_name, status, expiresAt) => {
    await insertInvitation({ status, email: INVITEE_EMAIL, expiresAt });

    expect(await runAccept(acceptAsInvitee)).toBeNull();
    expect(await membersOf()).toEqual([]);
    expect(await invitationStatusOf()).toBe(status);
  });

  it("宛先が違う人（転送されたリンク）では、メンバーが作られない", async () => {
    await insertInvitation({
      status: InvitationStatus.Pending,
      email: INVITEE_EMAIL,
      expiresAt: NOT_EXPIRED,
    });

    const result = await runAccept({
      ...acceptAsInvitee,
      email: OTHER_EMAIL,
      userId: "usr_other",
    });

    expect(result).toBeNull();
    expect(await membersOf()).toEqual([]);
    expect(await invitationStatusOf()).toBe(InvitationStatus.Pending);
  });

  /*
   * 退行テスト。
   * メンバーを作る文の条件が「すでに accepted の行」になっていた時期は、
   * 正規の宛先が承諾したあとの招待 ID を送るだけで、誰でもメンバーになれてしまった。
   * ユースケースは 404 を返すため、権限が付いたことに誰も気付けない。
   */
  it("正規の宛先が承諾したあとの招待 ID を第三者が送っても、メンバーが作られない", async () => {
    await insertInvitation({
      status: InvitationStatus.Pending,
      email: INVITEE_EMAIL,
      expiresAt: NOT_EXPIRED,
    });

    expect(await runAccept(acceptAsInvitee)).toBe("grp_1");

    const result = await runAccept({
      ...acceptAsInvitee,
      email: OTHER_EMAIL,
      userId: "usr_other",
      membershipId: "mem_other",
    });

    expect(result).toBeNull();
    expect(await membersOf()).toEqual([{ user_id: "usr_invitee", role: MembershipRole.Admin }]);
  });

  /*
   * 承諾したあとに団体から外された人が、同じリンクをもう一度開く場合。
   * 招待はもう承諾待ちではないので、勝手に所属が戻ってはいけない。
   */
  it("承諾後に団体から外された人が同じリンクを送り直しても、所属は戻らない", async () => {
    await insertInvitation({
      status: InvitationStatus.Pending,
      email: INVITEE_EMAIL,
      expiresAt: NOT_EXPIRED,
    });

    expect(await runAccept(acceptAsInvitee)).toBe("grp_1");
    await testDb.seed([`DELETE FROM "group_member" WHERE user_id = ?`, "usr_invitee"]);

    expect(await runAccept({ ...acceptAsInvitee, membershipId: "mem_again" })).toBeNull();
    expect(await membersOf()).toEqual([]);
  });

  it("すでにメンバーの人が承諾しても、既存の役割が書き換わらない", async () => {
    await insertInvitation({
      status: InvitationStatus.Pending,
      email: INVITEE_EMAIL,
      expiresAt: NOT_EXPIRED,
    });
    await testDb.seed([
      `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      "mem_old",
      "grp_1",
      "usr_invitee",
      MembershipRole.Member,
      0,
      0,
    ]);

    expect(await runAccept(acceptAsInvitee)).toBe("grp_1");
    // 招待の役割は admin だが、既存の member のまま残る
    expect(await membersOf()).toEqual([{ user_id: "usr_invitee", role: MembershipRole.Member }]);
    expect(await invitationStatusOf()).toBe(InvitationStatus.Accepted);
  });
});
