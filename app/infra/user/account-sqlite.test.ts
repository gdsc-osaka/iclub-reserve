/**
 * アカウント設定（SCR-021）の読み書きを、本物の SQLite に対して実行して確かめるテスト。
 *
 * ユースケースのテストは Repository と Query を偽物に差し替えるので、SQL の誤りは素通りする。
 * ここで押さえたいのは次の 3 つ。どれも条件を 1 つ書き忘れただけで、型もユースケースのテストも通ってしまう。
 * - 他人のセッションのトークンを引けないこと（実装課題 8）
 * - 期限の切れたセッションを一覧に出さないこと
 * - パスキーを削除すると、最後に使った日時の行も消えること（ON DELETE CASCADE）
 *
 * マイグレーションをそのまま流す理由は `invitation-accept-sqlite.test.ts` と同じ。
 */
import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import * as schema from "~/db/schema";
import type { Database } from "../db";
import { createAccountSettingsQuery } from "./account-settings-query";
import { recordPasskeyUse } from "./passkey-usage-repo";
import { createUserSessionRepository } from "./user-session-repo";

const MIGRATIONS_DIR = join(process.cwd(), "drizzle", "migrations");

const NOW = new Date("2026-09-24T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

/** マイグレーションを流し、2 人のユーザーとそのセッション・パスキーを入れた DB を作る */
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
  insertUser.run("usr_taro", "太郎", "taro@ecs.osaka-u.ac.jp", 1, 0, 0, 0);
  insertUser.run("usr_hanako", "花子", "hanako@ecs.osaka-u.ac.jp", 1, 0, 0, 0);

  const insertSession = sqlite.prepare(
    `INSERT INTO "session" (id, expires_at, token, created_at, updated_at, user_agent, user_id) VALUES (?,?,?,?,?,?,?)`,
  );
  const at = (offsetHours: number) => NOW.getTime() + offsetHours * HOUR;
  // 太郎: 利用中の端末・ほかの端末・期限切れの端末
  insertSession.run(
    "ses_taro_pc",
    at(24),
    "tok_taro_pc",
    at(-48),
    at(-1),
    WINDOWS_CHROME,
    "usr_taro",
  );
  insertSession.run(
    "ses_taro_phone",
    at(24),
    "tok_taro_phone",
    at(-72),
    at(-5),
    IPHONE_SAFARI,
    "usr_taro",
  );
  insertSession.run("ses_taro_old", at(-1), "tok_taro_old", at(-200), at(-30), null, "usr_taro");
  // 花子
  insertSession.run(
    "ses_hanako",
    at(24),
    "tok_hanako",
    at(-2),
    at(-1),
    WINDOWS_CHROME,
    "usr_hanako",
  );

  const insertPasskey = sqlite.prepare(
    `INSERT INTO "passkey" (id, name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at, aaguid) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  // 名前の無い古いパスキー（AAGUID から Google Password Manager と分かる）と、名前の付いた新しいパスキー
  insertPasskey.run(
    "pk_taro_google",
    null,
    "pub",
    "usr_taro",
    "cred_taro_google",
    0,
    "multiDevice",
    1,
    at(-100),
    "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
  );
  insertPasskey.run(
    "pk_taro_mac",
    "Mac の Safari",
    "pub",
    "usr_taro",
    "cred_taro_mac",
    0,
    "singleDevice",
    0,
    at(-10),
    "00000000-0000-0000-0000-000000000000",
  );
  insertPasskey.run(
    "pk_hanako",
    "花子のパスキー",
    "pub",
    "usr_hanako",
    "cred_hanako",
    0,
    "multiDevice",
    1,
    at(-10),
    null,
  );

  const db = drizzle(sqlite, { schema }) as unknown as Database;
  return { db, sqlite };
};

describe("createUserSessionRepository.findOwnSessionToken", () => {
  it("自分のセッションなら、トークンを返す", async () => {
    const { db } = createDatabase();

    const result = await createUserSessionRepository(db).findOwnSessionToken(
      "usr_taro",
      "ses_taro_phone",
    );

    expect(result._unsafeUnwrap()).toBe("tok_taro_phone");
  });

  it("他人のセッションは、無いのと同じ null にする", async () => {
    const { db } = createDatabase();

    const result = await createUserSessionRepository(db).findOwnSessionToken(
      "usr_taro",
      "ses_hanako",
    );

    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("無いセッションは null にする", async () => {
    const { db } = createDatabase();

    const result = await createUserSessionRepository(db).findOwnSessionToken(
      "usr_taro",
      "ses_missing",
    );

    expect(result._unsafeUnwrap()).toBeNull();
  });
});

describe("createAccountSettingsQuery.findByUserId", () => {
  it("期限の切れていない自分のセッションだけを、最後に使った順に返し、トークンは含めない", async () => {
    const { db } = createDatabase();

    const result = await createAccountSettingsQuery(db).findByUserId(
      "usr_taro",
      "ses_taro_pc",
      NOW,
    );
    const { sessions } = result._unsafeUnwrap();

    expect(sessions.map((session) => session.id)).toEqual(["ses_taro_pc", "ses_taro_phone"]);
    expect(sessions.map((session) => session.deviceName)).toEqual([
      "Windows の Chrome",
      "iPhone の Safari",
    ]);
    expect(sessions.map((session) => session.isCurrent)).toEqual([true, false]);
    expect(JSON.stringify(sessions)).not.toContain("tok_");
  });

  it("自分のパスキーだけを登録の新しい順に返し、名前の無いものは AAGUID から名前を付ける", async () => {
    const { db } = createDatabase();

    const result = await createAccountSettingsQuery(db).findByUserId(
      "usr_taro",
      "ses_taro_pc",
      NOW,
    );
    const { passkeys } = result._unsafeUnwrap();

    expect(passkeys.map((item) => [item.id, item.label, item.backedUp])).toEqual([
      ["pk_taro_mac", "Mac の Safari", false],
      ["pk_taro_google", "Google Password Manager", true],
    ]);
    // 提供元が分かるものだけアイコンが付く。分からないものは画面が鍵のアイコンを出す
    expect(passkeys.map((item) => item.icon !== null)).toEqual([false, true]);
    // まだパスキーでログインしていないので、最後に使った日時は無い
    expect(passkeys.map((item) => item.lastUsedAt)).toEqual([null, null]);
  });
});

describe("recordPasskeyUse", () => {
  it("初めて使ったときは行を作り、2 回目からは日時を上書きする", async () => {
    const { db } = createDatabase();
    const query = createAccountSettingsQuery(db);
    const firstUse = new Date(NOW.getTime() - HOUR);

    await recordPasskeyUse(db, "cred_taro_google", firstUse);
    const afterFirst = (await query.findByUserId("usr_taro", "ses_taro_pc", NOW))._unsafeUnwrap();
    expect(afterFirst.passkeys.find((item) => item.id === "pk_taro_google")?.lastUsedAt).toEqual(
      firstUse,
    );

    await recordPasskeyUse(db, "cred_taro_google", NOW);
    const afterSecond = (await query.findByUserId("usr_taro", "ses_taro_pc", NOW))._unsafeUnwrap();
    expect(afterSecond.passkeys.find((item) => item.id === "pk_taro_google")?.lastUsedAt).toEqual(
      NOW,
    );
  });

  it("知らない資格情報 ID なら何もしない", async () => {
    const { db, sqlite } = createDatabase();

    await recordPasskeyUse(db, "cred_unknown", NOW);

    expect(sqlite.prepare(`SELECT count(*) AS n FROM passkey_last_used`).get()).toEqual({ n: 0 });
  });

  it("パスキーを削除すると、最後に使った日時の行も消える", async () => {
    const { db, sqlite } = createDatabase();
    await recordPasskeyUse(db, "cred_taro_google", NOW);

    sqlite.prepare(`DELETE FROM passkey WHERE id = ?`).run("pk_taro_google");

    expect(sqlite.prepare(`SELECT count(*) AS n FROM passkey_last_used`).get()).toEqual({ n: 0 });
  });
});
