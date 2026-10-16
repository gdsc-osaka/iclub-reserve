/**
 * 事務局の管理（findStaffManagement）をローカル D1 に対して検証するテスト。
 *
 * - 事務局でない人には Forbidden を返す
 * - メンバーと承諾待ち招待の並び順、pending の絞り込み
 * - 期限切れの除外（期限を過ぎたもの・ちょうど now のものは出ない、now より後のものは出る）
 */
import { describe, expect, it } from "vitest";

import { InvitationStatus } from "~/domain/invitation";
import { useD1TestDb } from "~/infra/d1-test-db";
import { seedStaffInvitation, seedUser } from "~/infra/d1-test-seeds";
import { QueryErrorCode } from "../error";
import { findStaffManagement } from "./staff-management";

const testDb = useD1TestDb();

describe("findStaffManagement", () => {
  it("事務局でない人には Forbidden を返す（COND-009）", async () => {
    const result = await findStaffManagement(testDb.db, {
      isStaff: false,
      now: new Date("2026-10-09T12:00:00+09:00"),
    });

    expect(result._unsafeUnwrapErr().code).toBe(QueryErrorCode.Forbidden);
  });

  it("読み取りモデルの並び順と pending の絞り込み", async () => {
    // 氏名の昇順、同名は id の昇順
    // expires_at の昇順、同期限は id の昇順
    await testDb.seed(
      seedUser({ id: "usr_b", name: "B 事務局", email: "b@osaka-u.ac.jp", is_staff: true }),
      seedUser({ id: "usr_a2", name: "A 事務局", email: "a2@osaka-u.ac.jp", is_staff: true }),
      seedUser({ id: "usr_a1", name: "A 事務局", email: "a1@osaka-u.ac.jp", is_staff: true }),
      seedUser({
        id: "usr_normal",
        name: "一般 太郎",
        email: "normal@osaka-u.ac.jp",
        is_staff: false,
      }), // 事務局でない
      seedStaffInvitation({
        id: "inv_2",
        email: "two@osaka-u.ac.jp",
        expiresAt: new Date(2000),
        inviterId: "usr_a1",
      }),
      seedStaffInvitation({
        id: "inv_1b",
        email: "one_b@osaka-u.ac.jp",
        expiresAt: new Date(1000),
        inviterId: "usr_a1",
      }),
      seedStaffInvitation({
        id: "inv_1a",
        email: "one_a@osaka-u.ac.jp",
        expiresAt: new Date(1000),
        inviterId: "usr_a1",
      }),
      seedStaffInvitation({
        id: "inv_canceled",
        email: "canceled@osaka-u.ac.jp",
        status: InvitationStatus.Canceled,
        expiresAt: new Date(3000),
        inviterId: "usr_a1",
      }), // pending でない
    );

    const result = await findStaffManagement(testDb.db, {
      isStaff: true,
      now: new Date(500),
    });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      const { members, pendingInvitations } = result.value;

      // 事務局のみ、A 事務局(usr_a1) → A 事務局(usr_a2) → B 事務局(usr_b)
      expect(members).toHaveLength(3);
      expect(members[0].userId).toBe("usr_a1");
      expect(members[0].name).toBe("A 事務局");
      expect(members[1].userId).toBe("usr_a2");
      expect(members[2].userId).toBe("usr_b");

      // pending のみ、期限 1000(inv_1a) → 期限 1000(inv_1b) → 期限 2000(inv_2)
      expect(pendingInvitations).toHaveLength(3);
      expect(pendingInvitations[0].id).toBe("inv_1a");
      expect(pendingInvitations[1].id).toBe("inv_1b");
      expect(pendingInvitations[2].id).toBe("inv_2");
    }
  });

  it("期限を過ぎた招待は承諾待ちの一覧に出さない（STATE-003・SCR-007 と同じ扱い）", async () => {
    const now = new Date("2026-10-09T12:00:00+09:00");
    await testDb.seed(
      seedUser({ id: "usr_staff", name: "スタッフ", email: "staff@osaka-u.ac.jp", is_staff: true }),
      // 期限ちょうどは、もう承諾できないので出さない
      seedStaffInvitation({
        id: "sinv_expired_now",
        email: "a@osaka-u.ac.jp",
        expiresAt: now,
        inviterId: "usr_staff",
      }),
      seedStaffInvitation({
        id: "sinv_expired",
        email: "b@osaka-u.ac.jp",
        expiresAt: new Date("2026-10-09T11:59:59+09:00"),
        inviterId: "usr_staff",
      }),
      seedStaffInvitation({
        id: "sinv_valid",
        email: "c@osaka-u.ac.jp",
        expiresAt: new Date("2026-10-09T12:00:01+09:00"),
        inviterId: "usr_staff",
      }),
    );

    const result = await findStaffManagement(testDb.db, {
      isStaff: true,
      now,
    });

    expect(result._unsafeUnwrap().pendingInvitations.map((invitation) => invitation.id)).toEqual([
      "sinv_valid",
    ]);
  });
});
