import { eq } from "drizzle-orm";
import { user, verification } from "~/db/schema";
import { otpIdentifier, signInWithCode } from "../support/auth.js";
import { uniqueSuffix } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-019 アカウントを登録する（`rdra/contexts/user-authentication.md`）
 *
 * 登録の画面は無く、ログイン画面に未登録のアドレスを入れるとアカウントができる。
 * そのため UC-020 と同じく、`signInAs` は使わずに画面で認証コードを入れる。
 */
test.describe("UC-019 アカウントを登録する", { tag: "@UC-019" }, () => {
  test("未登録の阪大のアドレスで認証コードを入れると、氏名を登録してダッシュボードに入れる", async ({
    page,
    db,
  }) => {
    const email = `e2e-new-${uniqueSuffix()}@ecs.osaka-u.ac.jp`;
    const name = `E2E 新規 ${uniqueSuffix()}`;

    await openPage(page, "/login");
    await signInWithCode(page, db, email);

    // 氏名が空のアカウントができ、初回設定（SCR-014）で氏名を聞かれる
    await expect(page).toHaveURL("/welcome");
    await page.getByLabel("お名前").fill(name);
    await page.getByRole("button", { name: "登録して次へ" }).click();

    // ダッシュボードに入れ、アカウントには入れた氏名が残っている
    await expect(page).toHaveURL("/");
    const [created] = await db.select().from(user).where(eq(user.email, email));
    expect(created?.name).toBe(name);
  });

  test("阪大以外のアドレスには認証コードを送らない", async ({ page, db }) => {
    const email = `e2e-${uniqueSuffix()}@example.com`;

    await openPage(page, "/login");
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByRole("button", { name: "メールアドレスで続ける" }).click();

    // 使えるアドレスの案内が出て、認証コードの入力へは進まない（COND-004）
    await expect(
      page.getByText("@osaka-u.ac.jp のメールアドレスでのみご利用いただけます。"),
    ).toBeVisible();
    await expect(page.getByLabel("認証コード")).toBeHidden();

    // 認証コードは作られず、アカウントもできていない
    const codes = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, otpIdentifier.signIn(email)));
    expect(codes).toHaveLength(0);
    const users = await db.select().from(user).where(eq(user.email, email));
    expect(users).toHaveLength(0);
  });
});
