import { beforeEach, describe, expect, it } from "vitest";

import { InvitationStatus } from "~/domain/invitation";
import { MembershipRole } from "~/domain/membership";
import { useD1TestDb } from "~/infra/d1-test-db";
import { findUserInvitations } from "./user-invitations";

const testDb = useD1TestDb();

const INVITER = { id: "usr_inviter", name: "招待者", email: "inviter@example.com" };
const TARGET_EMAIL = "target@example.com";
const OTHER_EMAIL = "other@example.com";
const NOW = new Date("2026-10-20T12:00:00+09:00");

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      INVITER.id,
      INVITER.name,
      INVITER.email,
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_1",
      "ロボット研究会",
      "enabled",
      0,
      0,
    ],
    [
      `INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`,
      "grp_2",
      "プログラミング同好会",
      "enabled",
      0,
      0,
    ],
  );
});

async function insertInvitation(
  id: string,
  groupId: string,
  email: string,
  role: MembershipRole,
  status: InvitationStatus,
  expiresAt: Date,
) {
  await testDb.seed([
    `INSERT INTO "group_invitation" (id, group_id, email, role, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?,?,?)`,
    id,
    groupId,
    email,
    role,
    status,
    expiresAt.getTime(),
    0,
    INVITER.id,
  ]);
}

describe("findUserInvitations", () => {
  it("指定メールアドレス宛ての、承諾待ちかつ期限内の招待のみを返す", async () => {
    // 1. 有効な招待（対象）
    await insertInvitation(
      "inv_valid_1",
      "grp_1",
      TARGET_EMAIL,
      MembershipRole.Member,
      InvitationStatus.Pending,
      new Date(NOW.getTime() + 86400000), // 1日後
    );

    // 2. 有効な招待 2（対象）
    await insertInvitation(
      "inv_valid_2",
      "grp_2",
      TARGET_EMAIL,
      MembershipRole.Admin,
      InvitationStatus.Pending,
      new Date(NOW.getTime() + 172800000), // 2日後
    );

    // 3. 期限切れの招待
    await insertInvitation(
      "inv_expired",
      "grp_1",
      TARGET_EMAIL,
      MembershipRole.Member,
      InvitationStatus.Pending,
      new Date(NOW.getTime() - 1000), // 過去
    );

    // 4. 承諾済みの招待
    await insertInvitation(
      "inv_accepted",
      "grp_1",
      TARGET_EMAIL,
      MembershipRole.Member,
      InvitationStatus.Accepted,
      new Date(NOW.getTime() + 86400000),
    );

    // 5. 辞退済みの招待
    await insertInvitation(
      "inv_rejected",
      "grp_1",
      TARGET_EMAIL,
      MembershipRole.Member,
      InvitationStatus.Rejected,
      new Date(NOW.getTime() + 86400000),
    );

    // 6. 別人宛ての招待
    await insertInvitation(
      "inv_other",
      "grp_1",
      OTHER_EMAIL,
      MembershipRole.Member,
      InvitationStatus.Pending,
      new Date(NOW.getTime() + 86400000),
    );

    const result = await findUserInvitations(testDb.db, {
      actorEmail: TARGET_EMAIL,
      now: NOW,
    });
    expect(result.isOk()).toBe(true);
    if (!result.isOk()) return;

    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.id).toBe("inv_valid_1");
    expect(result.value[0]?.groupName).toBe("ロボット研究会");
    expect(result.value[0]?.role).toBe(MembershipRole.Member);

    expect(result.value[1]?.id).toBe("inv_valid_2");
    expect(result.value[1]?.groupName).toBe("プログラミング同好会");
    expect(result.value[1]?.role).toBe(MembershipRole.Admin);
  });

  it("大文字と前後の空白を含むメールアドレスで呼んでも正規化されて見つかる", async () => {
    await insertInvitation(
      "inv_valid_1",
      "grp_1",
      TARGET_EMAIL,
      MembershipRole.Member,
      InvitationStatus.Pending,
      new Date(NOW.getTime() + 86400000),
    );

    const result = await findUserInvitations(testDb.db, {
      actorEmail: "  Target@EXAMPLE.com  ",
      now: NOW,
    });

    expect(result._unsafeUnwrap().map((item) => item.id)).toEqual(["inv_valid_1"]);
  });
});
