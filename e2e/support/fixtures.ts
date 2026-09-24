import { test as base } from "@playwright/test";
import { signInAs } from "./auth.js";
import { openE2eDb, type E2eDb } from "./db.js";

/**
 * E2E のテストはすべて、`@playwright/test` ではなくこのファイルの `test` と `expect` を使う。
 *
 * Playwright の `test` に、次の 2 つを足してある。
 * - `db`: E2E のアプリが使っている DB（`e2e/support/db.ts`）
 * - `signInAs(userId)`: その人としてログインした状態にする（`e2e/support/auth.ts`）
 *
 * @example
 * test("一般メンバーが…", async ({ page, db, signInAs }) => {
 *   const member = await createUser(db);
 *   await signInAs(member.id);
 *   await openPage(page, "/reservations");
 * });
 */
export const test = base.extend<{ signInAs: (userId: string) => Promise<void> }, { db: E2eDb }>({
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
});

export { expect } from "@playwright/test";

/**
 * シードに入っている人たち。立場（事務局・団体の管理者など）で選ぶ。
 * どの立場の人がいるかは `scripts/seed/seed-data.ts` を参照。
 */
export { seedPersonas as personas } from "../../scripts/seed/seed-data.js";
