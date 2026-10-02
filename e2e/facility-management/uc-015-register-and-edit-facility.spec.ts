import { eq } from "drizzle-orm";
import { facilityTable } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { createFacility, createGroup, createUser, uniqueSuffix } from "../support/factories.js";
import { tinyPng } from "../support/files.js";
import { expect, personas, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-015 施設・設備を登録・編集する（`rdra/contexts/facility-management.md`）
 *
 * 写真は Cloudflare R2 に保存し、アプリの `/facility-photos/:photoName` から配る（ADR-005）。
 * E2E でも手元の R2 に保存されるので、画面の写真が実際に読み込めたかまで確かめる。
 */
test.describe("UC-015 施設・設備を登録・編集する", { tag: "@UC-015" }, () => {
  test("事務局が写真つきで施設を登録すると、一覧に写真つきで出る", async ({
    page,
    db,
    signInAs,
  }) => {
    const name = `E2E 登録した施設 ${uniqueSuffix()}`;
    await signInAs(personas.staff.id);

    await openPage(page, "/staff/facilities");
    await page.getByRole("link", { name: "施設を登録" }).click();
    await page.getByLabel("施設・設備名").fill(name);
    await page.getByLabel("説明（任意）").fill("E2E テストで登録した施設です。");
    await page.getByLabel("写真（任意）").setInputFiles(tinyPng);
    await page.getByRole("button", { name: "登録する" }).click();

    // 一覧に戻り、写真が読み込めている
    await expect(page).toHaveURL("/staff/facilities");
    const photo = page.getByRole("img", { name });
    await expect(photo).toBeVisible();
    await expect(photo).not.toHaveJSProperty("naturalWidth", 0);

    const [saved] = await db.select().from(facilityTable).where(eq(facilityTable.name, name));
    expect(saved?.isActive).toBe(true);
    expect(saved?.photoUrl).toBeTruthy();
  });

  test("事務局が施設の名前・説明・写真を編集できる", async ({ page, db, signInAs }) => {
    const facility = await createFacility(db);
    const newName = `E2E 編集した施設 ${uniqueSuffix()}`;
    await signInAs(personas.staff.id);

    await openPage(page, "/staff/facilities");
    await page.getByRole("link", { name: facility.name }).click();
    await page.getByLabel("施設・設備名").fill(newName);
    await page.getByLabel("説明（任意）").fill("説明を書き換えました。");
    await page.getByLabel("写真（任意）").setInputFiles(tinyPng);
    await page.getByRole("button", { name: "保存する" }).click();

    await expect(page.getByText("施設情報を保存しました。")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: `${newName} の編集` })).toBeVisible();
    await expect(page.getByRole("img", { name: newName })).not.toHaveJSProperty("naturalWidth", 0);

    const [saved] = await db.select().from(facilityTable).where(eq(facilityTable.id, facility.id));
    expect(saved?.name).toBe(newName);
    expect(saved?.description).toBe("説明を書き換えました。");
    expect(saved?.photoUrl).toBeTruthy();
  });

  test("事務局でない人は、施設管理の画面を開けない", async ({ page, db, signInAs }) => {
    const admin = await createUser(db);
    await createGroup(db, { members: [{ userId: admin.id, role: MembershipRole.Admin }] });
    await signInAs(admin.id);

    const response = await page.goto("/staff/facilities");

    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "事務局スタッフ専用ページです" })).toBeVisible();
    await expect(page.getByRole("link", { name: "施設を登録" })).toBeHidden();
  });
});
