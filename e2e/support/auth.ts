import type { BrowserContext } from "@playwright/test";
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
 * 最後に送った認証コードを DB から読む。まだ送っていなければ null。
 *
 * メールの代わりに、Better Auth が認証コードを保存している `verification` の行を見る。
 * 行は `sign-in-otp-<メールアドレス>` という名前で、値は `<認証コード>:<試した回数>` の形。
 * 送り直すと行が増えるので、いちばん新しい行を読む。
 *
 * NOTE: Better Auth の `storeOTP` を平文（既定）以外に変えると、ここでは読めなくなる。
 */
export async function readLatestSignInCode(db: E2eDb, email: string): Promise<string | null> {
  const [row] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.identifier, `sign-in-otp-${email}`))
    .orderBy(desc(verification.createdAt))
    .limit(1);

  return row?.value.split(":")[0] ?? null;
}
