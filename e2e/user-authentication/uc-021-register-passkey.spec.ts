import { eq } from "drizzle-orm";
import { passkey, session } from "~/db/schema";
import { accountCard } from "../support/account.js";
import { signInWithCode } from "../support/auth.js";
import { createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";
import { addVirtualAuthenticator } from "../support/passkey.js";

/**
 * UC-021 パスキーを登録する（`rdra/contexts/user-authentication.md`）
 *
 * どのテストも、仮想の認証器（`e2e/support/passkey.ts`）を足してから始める。
 * 足さないと、アプリは「この端末ではパスキーを作れない」と判断して、登録の案内を出さない。
 */
test.describe("UC-021 パスキーを登録する", { tag: "@UC-021" }, () => {
  test("認証コードでログインした後の案内から、パスキーを登録できる", async ({
    page,
    db,
    webAuthn,
  }) => {
    const user = await createUser(db);
    const authenticator = await addVirtualAuthenticator(webAuthn);

    await openPage(page, "/login");
    await signInWithCode(page, db, user.email);

    // パスキーを作れる端末なので、ダッシュボードの前に登録の案内（SCR-015）が出る
    await expect(page).toHaveURL("/passkey/suggest");
    await page.getByRole("button", { name: "パスキーを登録" }).click();
    await expect(page.getByText("パスキーを登録しました。")).toBeVisible();

    // 端末とアプリの両方にパスキーが残る
    expect(await authenticator.countCredentials()).toBe(1);
    expect(await db.select().from(passkey).where(eq(passkey.userId, user.id))).toHaveLength(1);

    await page.getByRole("button", { name: "続ける" }).click();
    await expect(page).toHaveURL("/");
  });

  test("アカウント設定からパスキーを追加すると、一覧に端末の名前で並ぶ", async ({
    page,
    db,
    signInAs,
    webAuthn,
  }) => {
    const user = await createUser(db);
    await addVirtualAuthenticator(webAuthn);
    await signInAs(user.id);

    await openPage(page, "/account");
    const card = accountCard(page, "パスキー");
    await expect(card.getByText("登録されているパスキーはありません。")).toBeVisible();

    await card.getByRole("button", { name: "パスキーを追加" }).click();
    await expect(page.getByText("パスキーを登録しました。")).toBeVisible();

    // 名前は登録した端末から付く（COND-020）。どの端末の名前になるかはテストを動かすパソコンによるので、DB と見比べる
    const [created] = await db.select().from(passkey).where(eq(passkey.userId, user.id));
    expect(created?.name, "パスキーに名前が付いていない").toBeTruthy();
    await expect(card.getByText(created?.name ?? "", { exact: true })).toBeVisible();
  });

  test("最後のログインから 24 時間たっていると、アカウント設定から追加できない", async ({
    page,
    db,
    signInAs,
    webAuthn,
  }) => {
    const user = await createUser(db);
    await addVirtualAuthenticator(webAuthn);
    await signInAs(user.id);

    // 前提: ログインしたのが 25 時間前だったことにする
    await db
      .update(session)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(session.userId, user.id));

    await openPage(page, "/account");
    const card = accountCard(page, "パスキー");

    // 追加のボタンの代わりに、ログインし直すよう案内が出る（COND-019）
    await expect(card.getByText(/最後のログインから 24\s*時間以上たっている/)).toBeVisible();
    await expect(card.getByRole("button", { name: "もう一度ログイン" })).toBeVisible();
    await expect(card.getByRole("button", { name: "パスキーを追加" })).toBeHidden();
  });
});
