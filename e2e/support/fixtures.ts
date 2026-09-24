import { test as base, type CDPSession } from "@playwright/test";
import { signInAs } from "./auth.js";
import { openE2eDb, type E2eDb } from "./db.js";

/**
 * E2E のテストはすべて、`@playwright/test` ではなくこのファイルの `test` と `expect` を使う。
 *
 * Playwright の `test` に、次の 3 つを足してある。
 * - `db`: E2E のアプリが使っている DB（`e2e/support/db.ts`）
 * - `signInAs(userId)`: その人としてログインした状態にする（`e2e/support/auth.ts`）
 * - `webAuthn`: パスキーの仮想の環境（下の説明を参照）
 *
 * @example
 * test("一般メンバーが…", async ({ page, db, signInAs }) => {
 *   const member = await createUser(db);
 *   await signInAs(member.id);
 *   await openPage(page, "/reservations");
 * });
 */
export const test = base.extend<
  { signInAs: (userId: string) => Promise<void>; webAuthn: CDPSession },
  { db: E2eDb }
>({
  // DB はテストを動かすプロセスごとに 1 回だけ開き、終わったら閉じる
  db: [
    // Playwright は 1 つめの引数が `{}` の形であることを求める（使う fixture を読み取るため）
    // oxlint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const { db, sqlite } = openE2eDb();
      await use(db);
      sqlite.close();
    },
    { scope: "worker" },
  ],

  signInAs: async ({ context, db }, use) => {
    await use((userId) => signInAs(context, db, userId));
  },

  /*
   * パスキーの仮想の環境（Chromium の CDP の WebAuthn）。すべてのテストで自動的に有効にする。
   *
   * アプリは「この端末でパスキーを作れるか」を見て、ログインの後にパスキーを勧める画面を挟む。
   * この答えは本物の端末に左右される（Windows Hello がある Windows では「作れる」、CI の Linux では「作れない」）。
   * 仮想の環境を有効にすると、ブラウザは本物の端末ではなく仮想の認証器だけを見るので、
   * どのパソコンでも「作れない」に揃う。
   *
   * パスキーを使うテストは、この `webAuthn` に仮想の認証器を足す。
   * @example
   * await webAuthn.send("WebAuthn.addVirtualAuthenticator", {
   *   options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
   * });
   */
  webAuthn: [
    async ({ context, page }, use) => {
      const session = await context.newCDPSession(page);
      await session.send("WebAuthn.enable", { enableUI: false });
      await use(session);
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";

/**
 * シードに入っている人たち。立場（事務局・団体の管理者など）で選ぶ。
 * どの立場の人がいるかは `scripts/seed/seed-data.ts` を参照。
 */
export { seedPersonas as personas } from "../../scripts/seed/seed-data.js";
