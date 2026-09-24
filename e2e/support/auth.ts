import { expect, type BrowserContext, type Page } from "@playwright/test";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { testUtils } from "better-auth/plugins";
import { desc, eq } from "drizzle-orm";
import { verification } from "~/db/schema";
import type { E2eDb } from "./db.js";
import { E2E_AUTH_SECRET, E2E_BASE_URL } from "./e2e-env.js";

/**
 * テスト側で使う Better Auth。ログイン済みの Cookie を作るためだけに使う。
 *
 * アプリ本体の設定（`app/lib/auth/auth.server.ts`）は Workers の上でしか読めないので、
 * ここでは Cookie の署名に要る部分だけを同じにした、別のインスタンスを作る。
 * - 秘密鍵と URL は E2E のアプリと同じ値（`e2e-env.ts`）
 * - DB は E2E のアプリと同じもの
 * - `user` の独自の列（`is_staff`）も本体に合わせる
 */
const createTestAuth = (db: E2eDb) =>
  betterAuth({
    secret: E2E_AUTH_SECRET,
    baseURL: E2E_BASE_URL,
    database: drizzleAdapter(db, { provider: "sqlite" }),
    user: {
      additionalFields: {
        is_staff: { type: "boolean", defaultValue: false, input: false, required: true },
      },
    },
    plugins: [testUtils()],
  });

/**
 * 指定した人としてログインした状態にする。
 *
 * ログインの画面は通らず、DB にセッションを作って Cookie をブラウザに渡す。
 * ログインそのものを確かめるテスト（UC-019・UC-020・UC-021）以外は、これを使う。
 * 画面から毎回ログインすると遅く、ログインとは関係のない所でテストが落ちやすくなるため。
 */
export async function signInAs(context: BrowserContext, db: E2eDb, userId: string): Promise<void> {
  const auth = await createTestAuth(db).$context;
  const cookies = await auth.test.getCookies({ userId, domain: "localhost" });
  await context.addCookies(cookies);
}

/**
 * 認証コードが DB の `verification` に保存されるときの名前（identifier）。
 *
 * Better Auth は、使い道ごとに `<使い道>-otp-<メールアドレス>` という名前で保存する。
 */
export const otpIdentifier = {
  /** ログイン（UC-019・UC-020）。ログイン画面で入れたアドレスに送る */
  signIn: (email: string) => `sign-in-otp-${email}`,
  /** メールアドレスの変更の 1 通目（UC-023）。今のアドレスに送る */
  emailVerification: (email: string) => `email-verification-otp-${email}`,
  /** メールアドレスの変更の 2 通目（UC-023）。新しいアドレスに送るが、名前には今のアドレスも入る */
  changeEmail: (currentEmail: string, newEmail: string) =>
    `change-email-otp-${currentEmail}-${newEmail}`,
} as const;

/**
 * 最後に送った認証コードを DB から読む。まだ送っていなければ null。
 *
 * メールの代わりに、Better Auth が認証コードを保存している `verification` の行を見る。
 * 行の名前は `otpIdentifier` で作る。値は `<認証コード>:<試した回数>` の形。
 * 送り直すと行が増えるので、いちばん新しい行を読む。
 *
 * NOTE: Better Auth の `storeOTP` を平文（既定）以外に変えると、ここでは読めなくなる。
 *
 * @example
 * const code = await readLatestOtp(db, otpIdentifier.signIn(user.email));
 */
export async function readLatestOtp(db: E2eDb, identifier: string): Promise<string | null> {
  const [row] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .orderBy(desc(verification.createdAt))
    .limit(1);

  return row?.value.split(":")[0] ?? null;
}

/**
 * ログイン画面でメールアドレスを入れ、届いた認証コードを入れてログインする。
 *
 * ログインそのものを確かめるテスト（UC-019・UC-020・UC-021）で使う。
 * ログイン画面を開いて、操作できる状態になってから呼ぶこと。
 */
export async function signInWithCode(page: Page, db: E2eDb, email: string): Promise<void> {
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "メールアドレスで続ける" }).click();

  // 認証コードの入力欄が出るのは、送信が終わってから。
  // 出る前に DB を読むと、前に送った古い認証コードを読んでしまうことがある。
  const codeInput = page.getByLabel("認証コード");
  await expect(codeInput).toBeVisible();

  const code = await readLatestOtp(db, otpIdentifier.signIn(email));
  expect(code, "認証コードが DB に保存されていない").not.toBeNull();

  await codeInput.fill(code ?? "");
  await page.getByRole("button", { name: "認証する" }).click();
}
