import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { reservationTable } from "~/db/schema";
import type { MailDraft } from "~/domain/mail/mail-outbox";

import {
  guardedMailOutboxInserts,
  mailOutboxInserts,
  type MailOutboxWrites,
} from "./mail-outbox-writes";

/*
 * 生成された SQL を覗く。db.batch に渡すだけの型（BatchItem）には toSQL が無いので、
 * 文の形を確かめたいテストの中だけで絞り込む。
 */
const toSQL = (statement: MailOutboxWrites["statements"][number]) =>
  (statement as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();

/*
 * 生成する SQL だけを見るので、D1 のバインディングは渡さない。
 * ここで確かめたいのは「文の形」であって、実際に書けるかどうかではない
 * （書けるかどうかはローカル D1 に対して手で確認している）。
 */
const db = drizzle(undefined as unknown as D1Database, { schema });

const draft: MailDraft = {
  idempotencyKey: "reservation:approved:res_1:usr_1",
  to: { address: "member@example.com", name: "メンバー" },
  subject: "件名",
  text: "本文",
};

/** `mail_outbox` の列。INSERT ... SELECT は位置で対応するため、並びが変わると壊れる */
const columns = [
  "id",
  "idempotency_key",
  "to_address",
  "to_name",
  "subject",
  "body_text",
  "body_html",
  "status",
  "attempt_count",
  "next_attempt_at",
  "last_error",
  "created_at",
  "updated_at",
];

describe("mailOutboxInserts", () => {
  it("MailDraft 1 通につき INSERT 1 文と ID 1 つを返す", () => {
    const writes = mailOutboxInserts(db, [draft, { ...draft, idempotencyKey: "k2" }]);

    expect(writes.statements).toHaveLength(2);
    expect(writes.ids).toHaveLength(2);
    // ID は行ごとに別のものを振る（同じ ID だと 2 通目が取り出せない）
    expect(new Set(writes.ids).size).toBe(2);
  });

  it("メールが無ければ何も返さない（呼び出し側が batch を使わずに済むように）", () => {
    const writes = mailOutboxInserts(db, []);

    expect(writes.statements).toHaveLength(0);
    expect(writes.ids).toHaveLength(0);
  });

  it("13 列すべてを定義順に書き、鍵が衝突しても batch を巻き戻さない", () => {
    const { sql } = toSQL(mailOutboxInserts(db, [draft]).statements[0]);

    for (const column of columns) {
      expect(sql).toContain(`"${column}"`);
    }
    expect(sql).toContain("on conflict");
    expect(sql).toContain("do nothing");
  });

  it("MailDraft の内容を列に写し、日時はミリ秒の整数で渡す", () => {
    const writes = mailOutboxInserts(db, [draft]);
    const { params } = toSQL(writes.statements[0]);

    expect(params).toEqual([
      writes.ids[0],
      "reservation:approved:res_1:usr_1",
      "member@example.com",
      "メンバー",
      "件名",
      "本文",
      // html が無ければ null。ここが undefined になると D1 が受け取れない
      null,
      "pending",
      0,
      expect.any(Number),
      null,
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it("宛先の名前と HTML 本文は省略できる", () => {
    const writes = mailOutboxInserts(db, [
      { idempotencyKey: "k", to: { address: "a@example.com" }, subject: "s", text: "t" },
    ]);
    const { params } = toSQL(writes.statements[0]);

    expect(params[3]).toBeNull();
    expect(params[6]).toBeNull();
  });
});

describe("guardedMailOutboxInserts", () => {
  const guard = {
    from: reservationTable,
    where: eq(reservationTable.id, "res_1"),
  };

  it("業務データの表を読む INSERT ... SELECT になり、条件が末尾に付く", () => {
    const { sql, params } = toSQL(guardedMailOutboxInserts(db, [draft], guard).statements[0]);

    expect(sql).toContain("select");
    expect(sql).toContain(`from "reservation"`);
    expect(sql).toContain(`"reservation"."id" = ?`);
    expect(sql).toContain("on conflict");
    // 条件のパラメータは 13 列の値のあとに続く
    expect(params.at(-1)).toBe("res_1");
  });

  it("SELECT 側の列も定義順にそろえる（位置で対応するため）", () => {
    const { sql } = toSQL(guardedMailOutboxInserts(db, [draft], guard).statements[0]);

    const positions = columns.map((column) => sql.indexOf(`as "${column}"`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("無条件版と同じ値を同じ並びで渡す", () => {
    const writes = guardedMailOutboxInserts(db, [draft], guard);
    const { params } = toSQL(writes.statements[0]);

    expect(params.slice(0, 13)).toEqual([
      writes.ids[0],
      "reservation:approved:res_1:usr_1",
      "member@example.com",
      "メンバー",
      "件名",
      "本文",
      null,
      "pending",
      0,
      expect.any(Number),
      null,
      expect.any(Number),
      expect.any(Number),
    ]);
  });
});
