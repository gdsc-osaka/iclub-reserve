import { eq } from "drizzle-orm";
import { user } from "~/db/schema";
import { createUser } from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-028 事務局権限を剥奪する（`rdra/contexts/user-authentication.md`）
 *
 * 操作するのは、事務局管理画面（SCR-019、`/staff/staff-members`）。
 */
test.describe("UC-028 事務局権限を剥奪する", { tag: "@UC-028" }, () => {
  test("事務局が他の事務局の権限を剥奪すると一覧から消え、DB の権限も更新される", async ({
    page,
    db,
    signInAs,
  }) => {
    const staffA = await createUser(db, { is_staff: true });
    const staffB = await createUser(db, { is_staff: true });
    await signInAs(staffA.id);

    await openPage(page, "/staff/staff-members");
    await page.getByRole("button", { name: `${staffB.name} の事務局権限を剥奪` }).click();

    const dialog = page.getByRole("alertdialog", { name: "事務局権限を剥奪しますか？" });
    await dialog.getByRole("button", { name: "剥奪する" }).click();

    // ダイアログが閉じ、一覧から非表示になる
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("listitem").filter({ hasText: staffB.name })).toBeHidden();

    // DB 上で is_staff が false に更新されている
    const [savedB] = await db.select().from(user).where(eq(user.id, staffB.id));
    expect(savedB?.is_staff).toBe(false);
  });

  test("自分自身の剥奪を行うとホームへリダイレクトされ、メニューから消え、管理画面が 403 になる", async ({
    page,
    db,
    signInAs,
  }) => {
    const staffA = await createUser(db, { is_staff: true });
    // COND-014（最後の事務局保護）を満たすため、別の事務局を残しておく
    await createUser(db, { is_staff: true });
    await signInAs(staffA.id);

    await openPage(page, "/staff/staff-members");
    await page.getByRole("button", { name: `${staffA.name} の事務局権限を剥奪` }).click();

    const dialog = page.getByRole("alertdialog", { name: "自分の事務局権限を剥奪しますか？" });
    await dialog.getByRole("button", { name: "剥奪する" }).click();

    // ホーム画面へリダイレクトされる
    await expect(page).toHaveURL("/");

    // ナビゲーションから事務局の管理が消えている
    await expect(page.getByRole("link", { name: "事務局の管理" })).toBeHidden();

    // 事務局管理画面を再度開くと 403 画面になる
    await openPage(page, "/staff/staff-members");
    await expect(page.getByRole("heading", { name: "事務局スタッフ専用ページです" })).toBeVisible();
  });

  test("画面を開いた後に相手が事務局でなくなっていると、剥奪できず読み込み直しを促される", async ({
    page,
    db,
    signInAs,
  }) => {
    const staffA = await createUser(db, { is_staff: true });
    const targetStaff = await createUser(db, { is_staff: true });
    await signInAs(staffA.id);

    await openPage(page, "/staff/staff-members");
    await page.getByRole("button", { name: `${targetStaff.name} の事務局権限を剥奪` }).click();

    const dialog = page.getByRole("alertdialog", { name: "事務局権限を剥奪しますか？" });
    await expect(dialog).toBeVisible();

    // ほかの事務局が先に剥奪したことにする
    await db.update(user).set({ is_staff: false }).where(eq(user.id, targetStaff.id));

    await dialog.getByRole("button", { name: "剥奪する" }).click();

    await expect(
      page.getByText("対象の方はすでに事務局ではありません。画面を読み込み直してください。"),
    ).toBeVisible();
  });
});
