/**
 * 承諾時に生成される SQL の形状を検査するテスト。
 *
 * 【なぜ SQL の形を検査するのか】
 * `db.batch()` による承諾処理は、条件付き UPDATE と `INSERT ... SELECT` の 2 文で構成されている。
 * この 2 文は、WHERE 句の条件が 1 つでも欠けると、期限切れや取り消し済み、宛先違いなど
 * 承諾できないはずの人が誤ってメンバーに追加されてしまう重大な不具合を引き起こす。
 * また、`INSERT ... SELECT` の SELECT 側は、挿入先の列と 1 対 1 に対応していなければならない。
 * Drizzle は挿入先の列名を明示して出すため位置だけで対応が決まるわけではないが、
 * 並びが定義とずれていると読む人が対応を追えなくなるので、並び順もあわせて確かめる。
 * これらが保たれていることを、本番環境で実行する前にテストで担保する。
 */
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { InvitationStatus, type AcceptInvitationInput } from "~/domain/invitation";
import type { Database } from "../db";
import { invitationAcceptStatements } from "./invitation-repo";

/*
 * 生成された SQL を覗く。db.batch に渡すだけの型（BatchItem）には toSQL が無いので、
 * 文の形を確かめたいテストの中だけで絞り込む。
 */
const toSQL = (statement: ReturnType<typeof invitationAcceptStatements>[number]) =>
  (statement as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();

/*
 * 生成する SQL だけを見るので、D1 のバインディングは渡さない。
 * ここで確かめたいのは「文の形」であって、実際に書けるかどうかではない。
 */
const db = drizzle(undefined as unknown as D1Database, { schema }) as unknown as Database;

/** `group_member` の列。SELECT 側がこの並びと一致していることを確かめる */
const memberColumns = ["id", "group_id", "user_id", "role", "created_at", "updated_at"];

describe("invitationAcceptStatements", () => {
  const sampleInput: AcceptInvitationInput = {
    invitationId: "inv_123456",
    email: "student@ecs.osaka-u.ac.jp",
    userId: "usr_student",
    membershipId: "mem_123456",
    now: new Date("2026-04-01T10:00:00.000Z"),
  };

  it("1 文目は group_invitation の UPDATE で、WHERE に 4 つの条件が入り returning に group_id が含まれる", () => {
    const [updateStmt] = invitationAcceptStatements(db, sampleInput);
    const { sql, params } = toSQL(updateStmt);

    // group_invitation の UPDATE であること
    expect(sql).toContain(`update "group_invitation"`);
    expect(sql).toContain(`set "status" = ?`);

    // WHERE に 4 条件が含まれること (id, status, email, expires_at)
    expect(sql).toContain(`"group_invitation"."id" = ?`);
    expect(sql).toContain(`"group_invitation"."status" = ?`);
    expect(sql).toContain(`"group_invitation"."email" = ?`);
    expect(sql).toContain(`"group_invitation"."expires_at" > ?`);

    // returning に group_id が含まれること
    expect(sql).toContain(`returning "group_id"`);

    // パラメータの検証: status = accepted, id, status = pending, email, expires_at (ミリ秒)
    expect(params).toEqual([
      InvitationStatus.Accepted,
      sampleInput.invitationId,
      InvitationStatus.Pending,
      sampleInput.email,
      sampleInput.now.getTime(),
    ]);
  });

  it("2 文目は group_member への INSERT ... SELECT で、from group_invitation と status = accepted を持ち、on conflict do nothing が付く", () => {
    const [, insertStmt] = invitationAcceptStatements(db, sampleInput);
    const { sql, params } = toSQL(insertStmt);

    // group_member への INSERT であること
    expect(sql).toContain(`insert into "group_member"`);
    // SELECT であること
    expect(sql).toContain("select");
    // from group_invitation であること
    expect(sql).toContain(`from "group_invitation"`);
    // 直前の UPDATE が accepted にした行を対象にすること
    expect(sql).toContain(`"group_invitation"."id" = ?`);
    expect(sql).toContain(`"group_invitation"."status" = ?`);

    // on conflict do nothing が付いていること
    expect(sql).toContain("on conflict");
    expect(sql).toContain("do nothing");

    // WHERE 句に渡る status パラメータが accepted であること
    expect(params).toContain(InvitationStatus.Accepted);
  });

  it("2 文目の SELECT 側の列が group_member の定義順に並ぶ", () => {
    const [, insertStmt] = invitationAcceptStatements(db, sampleInput);
    const { sql } = toSQL(insertStmt);

    // select から from までの SELECT 句を取り出す
    const selectClauseMatch = sql.match(/select\s+(.+?)\s+from/i);
    expect(selectClauseMatch).not.toBeNull();
    const selectClause = selectClauseMatch![1];

    const positions = memberColumns.map((column) => selectClause.indexOf(`"${column}"`));

    // 全ての列が SELECT 句に存在すること
    expect(positions.every((pos) => pos >= 0)).toBe(true);

    // 定義順と一致して昇順に並んでいること
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
