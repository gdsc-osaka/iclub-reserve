import { eq } from "drizzle-orm";
import { facilityTable } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { nextWeekAt, Weekday } from "../support/dates.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
} from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-016 施設・設備を無効化・再有効化する（`rdra/contexts/facility-management.md`）
 *
 * 有効・無効の切り替えは、施設の編集画面の「施設の状態」から行う。
 */
test.describe("UC-016 施設・設備を無効化・再有効化する", { tag: "@UC-016" }, () => {
  test("事務局が編集画面から施設を無効にし、また有効に戻せる", async ({ page, db, signInAs }) => {
    const facility = await createFacility(db);
    await signInAs(personas.staff.id);

    await openPage(page, `/staff/facilities/${facility.id}`);

    // 無効にする
    await page.getByRole("button", { name: "無効化" }).click();
    await page
      .getByRole("alertdialog", { name: `${facility.name} を無効にしますか？` })
      .getByRole("button", { name: "無効化する" })
      .click();
    await expect(page.getByText(`${facility.name} を無効にしました。`)).toBeVisible();

    // 有効に戻す
    await page.getByRole("button", { name: "有効化" }).click();
    await page
      .getByRole("alertdialog", { name: `${facility.name} を有効にしますか？` })
      .getByRole("button", { name: "有効化する" })
      .click();
    await expect(page.getByText(`${facility.name} を有効にしました。`)).toBeVisible();

    const [saved] = await db.select().from(facilityTable).where(eq(facilityTable.id, facility.id));
    expect(saved?.isActive).toBe(true);
  });

  test("今後の予約が残っている施設は無効にできない", async ({ page, db, signInAs }) => {
    // 前提: この施設に、来週の仮予約が 1 件残っている
    const facility = await createFacility(db);
    const applicant = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Member }],
    });
    await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: applicant.id,
      startAt: nextWeekAt(Weekday.Wednesday, 10),
      endAt: nextWeekAt(Weekday.Wednesday, 12),
    });
    await signInAs(personas.staff.id);

    await openPage(page, `/staff/facilities/${facility.id}`);
    await page.getByRole("button", { name: "無効化" }).click();
    await page
      .getByRole("alertdialog", { name: `${facility.name} を無効にしますか？` })
      .getByRole("button", { name: "無効化する" })
      .click();

    // 残っている予約の件数と、先に片付ける方法が出る（COND-003）
    await expect(
      page.getByText(/今後の予約が 1 件残っているため、無効化できません。/),
    ).toBeVisible();

    const [saved] = await db.select().from(facilityTable).where(eq(facilityTable.id, facility.id));
    expect(saved?.isActive).toBe(true);
  });
});
