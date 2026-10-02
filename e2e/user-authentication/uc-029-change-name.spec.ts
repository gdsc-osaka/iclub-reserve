import { eq } from "drizzle-orm";
import { user as userTable } from "~/db/schema";
import { accountCard } from "../support/account.js";
import { createUser, uniqueSuffix } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-029 氏名を変更する（`rdra/contexts/user-authentication.md`）
 */
test.describe("UC-029 氏名を変更する", { tag: "@UC-029" }, () => {
  test("アカウント設定で氏名を変えると、新しい氏名が出る", async ({ page, db, signInAs }) => {
    const user = await createUser(db);
    const newName = `E2E 改名 ${uniqueSuffix()}`;
    await signInAs(user.id);

    await openPage(page, "/account");
    const card = accountCard(page, "氏名");
    await card.getByRole("button", { name: "変更" }).click();
    await card.getByLabel("お名前（本名）").fill(newName);
    await card.getByRole("button", { name: "保存" }).click();

    await expect(page.getByText("氏名を更新しました。")).toBeVisible();
    await expect(card.getByText(newName, { exact: true })).toBeVisible();

    const [saved] = await db.select().from(userTable).where(eq(userTable.id, user.id));
    expect(saved?.name).toBe(newName);
  });

  test("空白だけの氏名には変えられない", async ({ page, db, signInAs }) => {
    const user = await createUser(db);
    await signInAs(user.id);

    await openPage(page, "/account");
    const card = accountCard(page, "氏名");
    await card.getByRole("button", { name: "変更" }).click();
    // 全角の空白も、前後の空白として取り除いてから確かめる（COND-017）
    await card.getByLabel("お名前（本名）").fill("　 　");
    await card.getByRole("button", { name: "保存" }).click();

    await expect(card.getByText("氏名を入力してください。")).toBeVisible();

    const [saved] = await db.select().from(userTable).where(eq(userTable.id, user.id));
    expect(saved?.name).toBe(user.name);
  });
});
