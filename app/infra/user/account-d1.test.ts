/**
 * アカウント設定（SCR-021）の読み書きを、本物の D1 に対して実行して確かめるテスト。
 *
 * ユースケースのテストは Repository と Query を偽物に差し替えるので、SQL の誤りは素通りする。
 * ここで押さえたいのは次の 3 つ。どれも条件を 1 つ書き忘れただけで、型もユースケースのテストも通ってしまう。
 * - 他人のセッションのトークンを引けないこと（実装課題 8）
 * - 期限の切れたセッションを一覧に出さないこと
 * - パスキーを削除すると、最後に使った日時の行も消えること（ON DELETE CASCADE）
 */
import { beforeEach, describe, expect, it } from "vitest";

import { useD1TestDb } from "../d1-test-db";
import { seedPasskey, seedSession, seedUser } from "../d1-test-seeds";
import { createAccountSettingsQuery } from "./account-settings-query";
import { recordPasskeyUse } from "./passkey-usage-repo";
import { createUserSessionRepository } from "./user-session-repo";

const NOW = new Date("2026-09-24T12:00:00Z");
const HOUR = 60 * 60 * 1000;

const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const testDb = useD1TestDb();

beforeEach(async () => {
  const at = (offsetHours: number) => new Date(NOW.getTime() + offsetHours * HOUR);

  await testDb.seed(
    seedUser({ id: "usr_taro", name: "太郎", email: "taro@ecs.osaka-u.ac.jp" }),
    seedUser({ id: "usr_hanako", name: "花子", email: "hanako@ecs.osaka-u.ac.jp" }),
    // 太郎: 利用中の端末・ほかの端末・期限切れの端末
    seedSession({
      id: "ses_taro_pc",
      expiresAt: at(24),
      token: "tok_taro_pc",
      createdAt: at(-48),
      updatedAt: at(-1),
      userAgent: WINDOWS_CHROME,
      userId: "usr_taro",
    }),
    seedSession({
      id: "ses_taro_phone",
      expiresAt: at(24),
      token: "tok_taro_phone",
      createdAt: at(-72),
      updatedAt: at(-5),
      userAgent: IPHONE_SAFARI,
      userId: "usr_taro",
    }),
    seedSession({
      id: "ses_taro_old",
      expiresAt: at(-1),
      token: "tok_taro_old",
      createdAt: at(-200),
      updatedAt: at(-30),
      userAgent: null,
      userId: "usr_taro",
    }),
    // 花子
    seedSession({
      id: "ses_hanako",
      expiresAt: at(24),
      token: "tok_hanako",
      createdAt: at(-2),
      updatedAt: at(-1),
      userAgent: WINDOWS_CHROME,
      userId: "usr_hanako",
    }),
    // 名前の無い古いパスキー（AAGUID から Google Password Manager と分かる）と、名前の付いた新しいパスキー
    seedPasskey({
      id: "pk_taro_google",
      name: null,
      publicKey: "pub",
      userId: "usr_taro",
      credentialID: "cred_taro_google",
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      createdAt: at(-100),
      aaguid: "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4",
    }),
    seedPasskey({
      id: "pk_taro_mac",
      name: "Mac の Safari",
      publicKey: "pub",
      userId: "usr_taro",
      credentialID: "cred_taro_mac",
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      createdAt: at(-10),
      aaguid: "00000000-0000-0000-0000-000000000000",
    }),
    seedPasskey({
      id: "pk_hanako",
      name: "花子のパスキー",
      publicKey: "pub",
      userId: "usr_hanako",
      credentialID: "cred_hanako",
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      createdAt: at(-10),
      aaguid: null,
    }),
  );
});

describe("createUserSessionRepository.findOwnSessionToken", () => {
  it("自分のセッションなら、トークンを返す", async () => {
    const result = await createUserSessionRepository(testDb.db).findOwnSessionToken(
      "usr_taro",
      "ses_taro_phone",
    );

    expect(result._unsafeUnwrap()).toBe("tok_taro_phone");
  });

  it("他人のセッションは、無いのと同じ null にする", async () => {
    const result = await createUserSessionRepository(testDb.db).findOwnSessionToken(
      "usr_taro",
      "ses_hanako",
    );

    expect(result._unsafeUnwrap()).toBeNull();
  });

  it("無いセッションは null にする", async () => {
    const result = await createUserSessionRepository(testDb.db).findOwnSessionToken(
      "usr_taro",
      "ses_missing",
    );

    expect(result._unsafeUnwrap()).toBeNull();
  });
});

describe("createAccountSettingsQuery.findByUserId", () => {
  it("期限の切れていない自分のセッションだけを、最後に使った順に返し、トークンは含めない", async () => {
    const result = await createAccountSettingsQuery(testDb.db).findByUserId(
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
    const result = await createAccountSettingsQuery(testDb.db).findByUserId(
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
    const query = createAccountSettingsQuery(testDb.db);
    const firstUse = new Date(NOW.getTime() - HOUR);

    await recordPasskeyUse(testDb.db, "cred_taro_google", firstUse);
    const afterFirst = (await query.findByUserId("usr_taro", "ses_taro_pc", NOW))._unsafeUnwrap();
    expect(afterFirst.passkeys.find((item) => item.id === "pk_taro_google")?.lastUsedAt).toEqual(
      firstUse,
    );

    await recordPasskeyUse(testDb.db, "cred_taro_google", NOW);
    const afterSecond = (await query.findByUserId("usr_taro", "ses_taro_pc", NOW))._unsafeUnwrap();
    expect(afterSecond.passkeys.find((item) => item.id === "pk_taro_google")?.lastUsedAt).toEqual(
      NOW,
    );
  });

  it("知らない資格情報 ID なら何もしない", async () => {
    await recordPasskeyUse(testDb.db, "cred_unknown", NOW);

    expect(await testDb.d1.prepare(`SELECT count(*) AS n FROM passkey_last_used`).first()).toEqual({
      n: 0,
    });
  });

  it("パスキーを削除すると、最後に使った日時の行も消える", async () => {
    await recordPasskeyUse(testDb.db, "cred_taro_google", NOW);

    await testDb.seed([`DELETE FROM passkey WHERE id = ?`, "pk_taro_google"]);

    expect(await testDb.d1.prepare(`SELECT count(*) AS n FROM passkey_last_used`).first()).toEqual({
      n: 0,
    });
  });
});
