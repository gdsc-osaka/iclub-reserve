/**
 * 事務局の管理（findStaffManagement）をローカル D1 に対して検証するテスト。
 *
 * - 事務局でない人には Forbidden を返す
 * - メンバーと承諾待ち招待の並び順、pending の絞り込み
 * - 期限切れの除外（期限を過ぎたもの・ちょうど now のものは出ない、now より後のものは出る）
 */
import { describe, expect, it } from "vitest";

import { useD1TestDb } from "~/infra/d1-test-db";
import { QueryErrorCode } from "../error";
import { findStaffManagement } from "./staff-management";

const testDb = useD1TestDb();

const insertUser = `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`;
const insertInv = `INSERT INTO "staff_invitation" (id, email, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?)`;

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
    await testDb.seed([insertUser, "usr_b", "B 事務局", "b@osaka-u.ac.jp", 1, 0, 0, 1]);
    await testDb.seed([insertUser, "usr_a2", "A 事務局", "a2@osaka-u.ac.jp", 1, 0, 0, 1]);
    await testDb.seed([insertUser, "usr_a1", "A 事務局", "a1@osaka-u.ac.jp", 1, 0, 0, 1]);
    await testDb.seed([insertUser, "usr_normal", "一般 太郎", "normal@osaka-u.ac.jp", 1, 0, 0, 0]); // 事務局でない

    // expires_at の昇順、同期限は id の昇順
    await testDb.seed([insertInv, "inv_2", "two@osaka-u.ac.jp", "pending", 2000, 0, "usr_a1"]);
    await testDb.seed([insertInv, "inv_1b", "one_b@osaka-u.ac.jp", "pending", 1000, 0, "usr_a1"]);
    await testDb.seed([insertInv, "inv_1a", "one_a@osaka-u.ac.jp", "pending", 1000, 0, "usr_a1"]);
    await testDb.seed([
      insertInv,
      "inv_canceled",
      "canceled@osaka-u.ac.jp",
      "canceled",
      3000,
      0,
      "usr_a1",
    ]); // pending でない

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
    await testDb.seed([insertUser, "usr_staff", "スタッフ", "staff@osaka-u.ac.jp", 1, 0, 0, 1]);

    // 期限ちょうどは、もう承諾できないので出さない
    await testDb.seed([
      insertInv,
      "sinv_expired_now",
      "a@osaka-u.ac.jp",
      "pending",
      now.getTime(),
      0,
      "usr_staff",
    ]);
    await testDb.seed([
      insertInv,
      "sinv_expired",
      "b@osaka-u.ac.jp",
      "pending",
      new Date("2026-10-09T11:59:59+09:00").getTime(),
      0,
      "usr_staff",
    ]);
    await testDb.seed([
      insertInv,
      "sinv_valid",
      "c@osaka-u.ac.jp",
      "pending",
      new Date("2026-10-09T12:00:01+09:00").getTime(),
      0,
      "usr_staff",
    ]);

    const result = await findStaffManagement(testDb.db, {
      isStaff: true,
      now,
    });

    expect(result._unsafeUnwrap().pendingInvitations.map((invitation) => invitation.id)).toEqual([
      "sinv_valid",
    ]);
  });
});
