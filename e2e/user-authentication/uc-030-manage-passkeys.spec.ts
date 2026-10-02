import { eq } from "drizzle-orm";
import { passkey } from "~/db/schema";
import { accountCard } from "../support/account.js";
import { createPasskey, createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-030 パスキーを管理する（`rdra/contexts/user-authentication.md`）
 *
 * 名前の変更と削除だけを確かめるので、パスキーは DB に直接入れる（`createPasskey`）。
 * そのパスキーではログインできないが、この UC では使わない。
 */
test.describe("UC-030 パスキーを管理する", { tag: "@UC-030" }, () => {
  test("パスキーの名前を変えられる", async ({ page, db, signInAs }) => {
    const user = await createUser(db);
    const registered = await createPasskey(db, { userId: user.id });
    await signInAs(user.id);

    await openPage(page, "/account");
    const card = accountCard(page, "パスキー");
    await expect(card.getByText(registered.name ?? "", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: "名前を変更" }).click();
    await card.getByRole("textbox").fill("研究室のパソコン");
    await card.getByRole("button", { name: "保存" }).click();

    await expect(page.getByText("パスキー名を変更しました。")).toBeVisible();
    await expect(card.getByText("研究室のパソコン", { exact: true })).toBeVisible();

    const [saved] = await db.select().from(passkey).where(eq(passkey.id, registered.id));
    expect(saved?.name).toBe("研究室のパソコン");
  });

  test("確認のダイアログを経て、パスキーを削除できる", async ({ page, db, signInAs }) => {
    const user = await createUser(db);
    const registered = await createPasskey(db, { userId: user.id });
    await signInAs(user.id);

    await openPage(page, "/account");
    const card = accountCard(page, "パスキー");
    await card.getByRole("button", { name: "削除" }).click();

    const dialog = page.getByRole("alertdialog", { name: "パスキーを削除しますか？" });
    await dialog.getByRole("button", { name: "削除する" }).click();

    await expect(page.getByText("パスキーを削除しました。")).toBeVisible();
    await expect(card.getByText("登録されているパスキーはありません。")).toBeVisible();

    const rows = await db.select().from(passkey).where(eq(passkey.id, registered.id));
    expect(rows).toHaveLength(0);
  });

  test("51 文字以上の名前には変えられない", async ({ page, db, signInAs }) => {
    const user = await createUser(db);
    const registered = await createPasskey(db, { userId: user.id });
    await signInAs(user.id);

    await openPage(page, "/account");
    const card = accountCard(page, "パスキー");
    await card.getByRole("button", { name: "名前を変更" }).click();
    await card.getByRole("textbox").fill("あ".repeat(51));
    await card.getByRole("button", { name: "保存" }).click();

    // 名前は氏名と同じく 50 文字まで（COND-020）
    await expect(card.getByText("パスキーの名前は 50 文字以内で入力してください。")).toBeVisible();

    const [saved] = await db.select().from(passkey).where(eq(passkey.id, registered.id));
    expect(saved?.name).toBe(registered.name);
  });
});
