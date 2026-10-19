import { desc, eq } from "drizzle-orm";
import { verification } from "../../app/db/schema/index.js";
import type { LocalDrizzleDb } from "./d1.js";

/**
 * 認証コードが DB の `verification` に保存されるときの名前（identifier）。
 *
 * Better Auth は、使い道ごとに `<使い道>-otp-<メールアドレス>` という名前で保存する。
 * E2E（`e2e/support/auth.ts`）と、ローカルでログインするためのスクリプト（`scripts/dev-otp.ts`）の両方から使う。
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
export async function readLatestOtp(
  db: LocalDrizzleDb["db"],
  identifier: string,
): Promise<string | null> {
  const [row] = await db
    .select({ value: verification.value })
    .from(verification)
    .where(eq(verification.identifier, identifier))
    .orderBy(desc(verification.createdAt))
    .limit(1);

  return row?.value.split(":")[0] ?? null;
}
