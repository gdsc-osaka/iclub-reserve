/**
 * 承諾の 2 文を、本物の SQLite に対して実行して確かめるテスト。
 *
 * 【なぜ文の形だけでなく実行結果まで見るのか】
 * `invitation-repo.test.ts` は生成される SQL の形を見るが、形が正しく見えても
 * 「どの行が書かれるか」は別の話である。実際に、2 文の条件が食い違っていた時期には
 * 「一度でも承諾された招待の ID を知っていれば、宛先が違う人でもメンバーになれる」
 * という不具合があり、形だけを見るテストでは素通りしていた。
 * 承諾は所属（＝権限）を与える操作なので、通る・通らないを実際の DB で押さえる。
 *
 * 【マイグレーションをそのまま適用している理由】
 * スキーマをテスト用に書き写すと、本物との食い違いに気付けない。
 * `drizzle/migrations/` を順に流し、外部キーも有効にして、本番と同じ形の上で確かめる。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/d1";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import { InvitationStatus, type AcceptInvitationInput } from "~/domain/invitation";
import { MembershipRole } from "~/domain/membership";
import type { Database } from "../db";
import { invitationAcceptStatements } from "./invitation-repo";

/** 文を組み立てるためだけの Drizzle。実行は better-sqlite3 が行う */
const builder = drizzle(undefined as unknown as D1Database, { schema }) as unknown as Database;

const toSQL = (statement: ReturnType<typeof invitationAcceptStatements>[number]) =>
  (statement as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

const NOW = new Date("2026-04-01T10:00:00.000Z");
const NOT_EXPIRED = new Date("2026-04-03T10:00:00.000Z");
const ALREADY_EXPIRED = new Date("2026-03-30T10:00:00.000Z");

const INVITEE_EMAIL = "hanako@ecs.osaka-u.ac.jp";
const OTHER_EMAIL = "jiro@ecs.osaka-u.ac.jp";

/** マイグレーションを流し、招待の関係者だけを入れた DB を作る */
const createDatabase = () => {
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.pragma("foreign_keys = ON");

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    // drizzle-kit は文の区切りにこの印を入れる
    for (const statement of body.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") sqlite.exec(statement.trim());
    }
  }

  const insertUser = sqlite.prepare(
    `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
  );
  insertUser.run("usr_inviter", "招待した管理者", "taro@ecs.osaka-u.ac.jp", 1, 0, 0, 0);
  insertUser.run("usr_invitee", "招待された人", INVITEE_EMAIL, 1, 0, 0, 0);
  insertUser.run("usr_other", "招待されていない人", OTHER_EMAIL, 1, 0, 0, 0);

  sqlite
    .prepare(`INSERT INTO "group" (id, name, status, created_at, updated_at) VALUES (?,?,?,?,?)`)
    .run("grp_1", "テスト団体", "enabled", 0, 0);

  return sqlite;
};

const insertInvitation = (
  sqlite: BetterSqlite3.Database,
  options: { readonly status: InvitationStatus; readonly email: string; readonly expiresAt: Date },
) => {
  sqlite
    .prepare(
      `INSERT INTO "group_invitation" (id, group_id, email, role, status, expires_at, created_at, inviter_id) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      "inv_1",
      "grp_1",
      options.email,
      MembershipRole.Admin,
      options.status,
      options.expiresAt.getTime(),
      0,
      "usr_inviter",
    );
};

/**
 * `db.batch()` と同じように、2 文を 1 つのトランザクションで順に実行する。
 *
 * 戻り値はユースケースが受け取るもの（承諾できた団体 ID、できなければ null）にそろえる。
 */
const runAccept = (sqlite: BetterSqlite3.Database, input: AcceptInvitationInput): string | null => {
  const [insertMember, acceptInvitation] = invitationAcceptStatements(builder, input);

  return sqlite.transaction(() => {
    const insert = toSQL(insertMember);
    sqlite.prepare(insert.sql).run(...(insert.params as never[]));

    const update = toSQL(acceptInvitation);
    const accepted = sqlite.prepare(update.sql).all(...(update.params as never[])) as {
      group_id: string;
    }[];

    return accepted.at(0)?.group_id ?? null;
  })();
};

const membersOf = (sqlite: BetterSqlite3.Database) =>
  sqlite.prepare(`SELECT user_id, role FROM "group_member" ORDER BY user_id`).all();

const invitationStatusOf = (sqlite: BetterSqlite3.Database) =>
  (
    sqlite.prepare(`SELECT status FROM "group_invitation" WHERE id = 'inv_1'`).get() as {
      status: string;
    }
  ).status;

const acceptAsInvitee: AcceptInvitationInput = {
  invitationId: "inv_1",
  email: INVITEE_EMAIL,
  userId: "usr_invitee",
  membershipId: "mem_new",
  now: NOW,
};

describe("承諾の 2 文を SQLite で実行する", () => {
  it("承諾待ち・宛先本人・期限内なら、メンバーが作られ招待が accepted になる", () => {
    const sqlite = createDatabase();
    insertInvitation(sqlite, {
      status: InvitationStatus.Pending,
      email: INVITEE_EMAIL,
      expiresAt: NOT_EXPIRED,
    });

    expect(runAccept(sqlite, acceptAsInvitee)).toBe("grp_1");
    // 役割は招待の行から読むので、招待したときの役割がそのまま入る
    expect(membersOf(sqlite)).toEqual([{ user_id: "usr_invitee", role: MembershipRole.Admin }]);
    expect(invitationStatusOf(sqlite)).toBe(InvitationStatus.Accepted);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it.each([
    ["取り消し済み", InvitationStatus.Canceled, NOT_EXPIRED],
    ["辞退済み", InvitationStatus.Rejected, NOT_EXPIRED],
    ["期限切れ", InvitationStatus.Pending, ALREADY_EXPIRED],
  ])("%s の招待では、メンバーが作られない", (_name, status, expiresAt) => {
    const sqlite = createDatabase();
    insertInvitation(sqlite, { status, email: INVITEE_EMAIL, expiresAt });

    expect(runAccept(sqlite, acceptAsInvitee)).toBeNull();
    expect(membersOf(sqlite)).toEqual([]);
    expect(invitationStatusOf(sqlite)).toBe(status);
  });

  it("宛先が違う人（転送されたリンク）では、メンバーが作られない", () => {
    const sqlite = createDatabase();
    insertInvitation(sqlite, {
      status: InvitationStatus.Pending,
      email: INVITEE_EMAIL,
      expiresAt: NOT_EXPIRED,
    });

    const result = runAccept(sqlite, {
      ...acceptAsInvitee,
      email: OTHER_EMAIL,
      userId: "usr_other",
    });

    expect(result).toBeNull();
    expect(membersOf(sqlite)).toEqual([]);
    expect(invitationStatusOf(sqlite)).toBe(InvitationStatus.Pending);
  });

  /*
   * 退行テスト。
   * メンバーを作る文の条件が「すでに accepted の行」になっていた時期は、
   * 正規の宛先が承諾したあとの招待 ID を送るだけで、誰でもメンバーになれてしまった。
   * ユースケースは 404 を返すため、権限が付いたことに誰も気付けない。
   */
  it("正規の宛先が承諾したあとの招待 ID を第三者が送っても、メンバーが作られない", () => {
    const sqlite = createDatabase();
    insertInvitation(sqlite, {
      status: InvitationStatus.Pending,
      email: INVITEE_EMAIL,
      expiresAt: NOT_EXPIRED,
    });

    expect(runAccept(sqlite, acceptAsInvitee)).toBe("grp_1");

    const result = runAccept(sqlite, {
      ...acceptAsInvitee,
      email: OTHER_EMAIL,
      userId: "usr_other",
      membershipId: "mem_other",
    });

    expect(result).toBeNull();
    expect(membersOf(sqlite)).toEqual([{ user_id: "usr_invitee", role: MembershipRole.Admin }]);
  });

  /*
   * 承諾したあとに団体から外された人が、同じリンクをもう一度開く場合。
   * 招待はもう承諾待ちではないので、勝手に所属が戻ってはいけない。
   */
  it("承諾後に団体から外された人が同じリンクを送り直しても、所属は戻らない", () => {
    const sqlite = createDatabase();
    insertInvitation(sqlite, {
      status: InvitationStatus.Pending,
      email: INVITEE_EMAIL,
      expiresAt: NOT_EXPIRED,
    });

    expect(runAccept(sqlite, acceptAsInvitee)).toBe("grp_1");
    sqlite.prepare(`DELETE FROM "group_member" WHERE user_id = 'usr_invitee'`).run();

    expect(runAccept(sqlite, { ...acceptAsInvitee, membershipId: "mem_again" })).toBeNull();
    expect(membersOf(sqlite)).toEqual([]);
  });

  it("すでにメンバーの人が承諾しても、既存の役割が書き換わらない", () => {
    const sqlite = createDatabase();
    insertInvitation(sqlite, {
      status: InvitationStatus.Pending,
      email: INVITEE_EMAIL,
      expiresAt: NOT_EXPIRED,
    });
    sqlite
      .prepare(
        `INSERT INTO "group_member" (id, group_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      )
      .run("mem_old", "grp_1", "usr_invitee", MembershipRole.Member, 0, 0);

    expect(runAccept(sqlite, acceptAsInvitee)).toBe("grp_1");
    // 招待の役割は admin だが、既存の member のまま残る
    expect(membersOf(sqlite)).toEqual([{ user_id: "usr_invitee", role: MembershipRole.Member }]);
    expect(invitationStatusOf(sqlite)).toBe(InvitationStatus.Accepted);
  });
});
