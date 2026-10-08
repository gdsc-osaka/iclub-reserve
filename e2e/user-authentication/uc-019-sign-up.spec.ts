import type { Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { user, verification } from "~/db/schema";
import { TERMS_OF_SERVICE } from "~/domain/authn/terms-of-service";
import type { E2eDb } from "../support/db.js";
import { otpIdentifier, signInWithCode } from "../support/auth.js";
import { createUser, uniqueSuffix } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-019 アカウントを登録する（`rdra/contexts/user-authentication.md`）
 *
 * 登録の画面は無く、ログイン画面に未登録のアドレスを入れるとアカウントができる。
 * そのため UC-020 と同じく、`signInAs` は使わずに画面で認証コードを入れる。
 *
 * 利用規約への同意（REQ-033）は、認証コードを入れた後の初回設定（SCR-014）で求める。
 */

/** 初回設定の同意の段階で、規約に同意して次へ進む */
async function acceptTerms(page: Page): Promise<void> {
  await expect(page.getByText("利用規約への同意", { exact: true })).toBeVisible();

  // 印を付けるまでは進めない
  const submit = page.getByRole("button", { name: "同意して次へ" });
  await expect(submit).toBeDisabled();
  await page.getByRole("checkbox", { name: `「${TERMS_OF_SERVICE.title}」に同意します` }).check();
  await submit.click();
}

/** 利用規約への同意として記録された版と日時を読む */
async function readTermsAcceptance(db: E2eDb, email: string) {
  const [row] = await db
    .select({ version: user.terms_version, acceptedAt: user.terms_accepted_at })
    .from(user)
    .where(eq(user.email, email));
  return row;
}
test.describe("UC-019 アカウントを登録する", { tag: "@UC-019" }, () => {
  test("未登録の阪大のアドレスで認証コードを入れると、利用規約に同意し、氏名を登録してダッシュボードに入れる", async ({
    page,
    db,
  }) => {
    const email = `e2e-new-${uniqueSuffix()}@ecs.osaka-u.ac.jp`;
    const name = `E2E 新規 ${uniqueSuffix()}`;

    await openPage(page, "/login");
    await signInWithCode(page, db, email);

    // 同意も氏名も無いアカウントができ、初回設定（SCR-014）でまず規約への同意を求められる
    await expect(page).toHaveURL("/welcome");
    await acceptTerms(page);

    // 続けて氏名を聞かれる
    await page.getByLabel("お名前").fill(name);
    await page.getByRole("button", { name: "登録して次へ" }).click();

    // ダッシュボードに入れ、アカウントには入れた氏名と、同意した規約の版が残っている
    await expect(page).toHaveURL("/");
    const [created] = await db.select().from(user).where(eq(user.email, email));
    expect(created?.name).toBe(name);
    expect(created?.terms_version).toBe(TERMS_OF_SERVICE.version);
    expect(created?.terms_accepted_at).not.toBeNull();
  });

  test("規約に同意していない登録済みの人は、同意するまでほかの画面を開けず、同意すると元の画面へ進む", async ({
    page,
    db,
  }) => {
    // 同意の仕組みより前に登録した人（氏名はあるが、同意の記録が無い）
    const existing = await createUser(db, { terms_version: null, terms_accepted_at: null });

    await openPage(page, "/login");
    await signInWithCode(page, db, existing.email);
    await expect(page).toHaveURL("/welcome");

    // 同意せずに予約一覧を開こうとしても、初回設定へ戻される（REQ-033）
    await openPage(page, "/reservations");
    await expect(page).toHaveURL("/welcome?redirectTo=%2Freservations");

    // 氏名は登録済みなので、同意すればそのまま元の画面へ進む
    await acceptTerms(page);
    await expect(page).toHaveURL("/reservations");

    const acceptance = await readTermsAcceptance(db, existing.email);
    expect(acceptance?.version).toBe(TERMS_OF_SERVICE.version);
    expect(acceptance?.acceptedAt).not.toBeNull();
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
