/**
 * 承諾時に生成される SQL の形状を検査するテスト。
 *
 * 【なぜ SQL の形を検査するのか】
 * `db.batch()` による承諾処理は、`INSERT ... SELECT` と条件付き UPDATE の 2 文でできている。
 * `db.batch()` は中の文を無条件に全部実行するため、2 文が同じ条件を見ていないと
 * 「招待は承諾できなかったのにメンバー行だけできる」という重大な不具合になる。
 * 条件が 1 つでも欠けたり食い違ったりしていないことを、ここで押さえる。
 *
 * また、`INSERT ... SELECT` の SELECT 側は、挿入先の列と 1 対 1 に対応していなければならない。
 * Drizzle は挿入先の列名を明示して出すため位置だけで対応が決まるわけではないが、
 * 並びが定義とずれていると読む人が対応を追えなくなるので、並び順もあわせて確かめる。
 *
 * なお、ここで見ているのは「文の形」だけである。実際にどの行が書かれるかは
 * `invitation-accept-sqlite.test.ts` が本物の SQLite に対して確かめている。
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

/** 承諾できる招待かどうかを決める 4 つの条件 */
const acceptableConditions = [
  `"group_invitation"."id" = ?`,
  `"group_invitation"."status" = ?`,
  `"group_invitation"."email" = ?`,
  `"group_invitation"."expires_at" > ?`,
];

/** `where` 以降の条件部分だけを取り出す（`returning` や `on conflict` は落とす） */
const whereClauseOf = (sql: string): string => {
  const matched = sql.match(/ where (.+?)(?: returning | on conflict |$)/);
  expect(matched).not.toBeNull();
  return matched![1];
};

describe("invitationAcceptStatements", () => {
  const sampleInput: AcceptInvitationInput = {
    invitationId: "inv_123456",
    email: "student@ecs.osaka-u.ac.jp",
    userId: "usr_student",
    membershipId: "mem_123456",
    now: new Date("2026-04-01T10:00:00.000Z"),
  };

  it("1 文目は group_member への INSERT ... SELECT で、承諾できる条件を持ち on conflict do nothing が付く", () => {
    const [insertStmt] = invitationAcceptStatements(db, sampleInput);
    const { sql, params } = toSQL(insertStmt);

    expect(sql).toContain(`insert into "group_member"`);
    expect(sql).toContain(`from "group_invitation"`);

    for (const condition of acceptableConditions) {
      expect(sql).toContain(condition);
    }

    // 承諾待ちの招待だけを読む（過去に承諾された行を拾わない）
    expect(params.slice(-4)).toEqual([
      sampleInput.invitationId,
      InvitationStatus.Pending,
      sampleInput.email,
      sampleInput.now.getTime(),
    ]);

    // すでにメンバーの人が承諾しても、既存の所属を書き換えない
    expect(sql).toContain("on conflict");
    expect(sql).toContain("do nothing");
  });

  it("2 文目は group_invitation の UPDATE で、同じ条件を持ち returning に group_id が含まれる", () => {
    const [, updateStmt] = invitationAcceptStatements(db, sampleInput);
    const { sql, params } = toSQL(updateStmt);

    expect(sql).toContain(`update "group_invitation"`);
    expect(sql).toContain(`set "status" = ?`);

    for (const condition of acceptableConditions) {
      expect(sql).toContain(condition);
    }

    // 承諾後の遷移先を引き直さずに済ませるため、団体 ID を返す
    expect(sql).toContain(`returning "group_id"`);

    expect(params).toEqual([
      InvitationStatus.Accepted,
      sampleInput.invitationId,
      InvitationStatus.Pending,
      sampleInput.email,
      sampleInput.now.getTime(),
    ]);
  });

  /*
   * この処理でいちばん壊れてはいけない性質。
   * 2 文の条件が少しでもずれると、承諾できない人がメンバーになる経路ができてしまう。
   */
  it("2 文の WHERE の条件と値が完全に一致する", () => {
    const [insertStmt, updateStmt] = invitationAcceptStatements(db, sampleInput);
    const insert = toSQL(insertStmt);
    const update = toSQL(updateStmt);

    expect(whereClauseOf(insert.sql)).toBe(whereClauseOf(update.sql));
    expect(insert.params.slice(-4)).toEqual(update.params.slice(-4));
  });

  it("1 文目の SELECT 側の列が group_member の定義順に並ぶ", () => {
    const [insertStmt] = invitationAcceptStatements(db, sampleInput);
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
