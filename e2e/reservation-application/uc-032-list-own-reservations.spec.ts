import type { Page } from "@playwright/test";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import { lastWeekAt, nextWeekAt, Weekday } from "../support/dates.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
} from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-032 自団体の予約一覧を確認する（`rdra/contexts/reservation-application.md`）
 *
 * 予約はテストごとに別の施設に入れ、一覧の行は施設の名前で見分ける。
 */

/** 予約一覧で、ある施設の予約の行を探す */
const rowOf = (page: Page, facilityName: string) =>
  page.getByRole("listitem").filter({ hasText: facilityName });

test.describe("UC-032 自団体の予約一覧を確認する", { tag: "@UC-032" }, () => {
  test("所属団体を切り替えると、その団体の予約だけが出る", async ({ page, db, signInAs }) => {
    // 前提: 2 つの団体に入っていて、どちらの団体にも予約が 1 件ずつある
    const member = await createUser(db);
    const groupA = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    const groupB = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    const facilityA = await createFacility(db);
    const facilityB = await createFacility(db);
    for (const [group, facility] of [
      [groupA, facilityA],
      [groupB, facilityB],
    ] as const) {
      await createReservation(db, {
        groupId: group.id,
        facilityId: facility.id,
        createdBy: member.id,
        startAt: nextWeekAt(Weekday.Monday, 10),
        endAt: nextWeekAt(Weekday.Monday, 12),
      });
    }
    await signInAs(member.id);

    await openPage(page, "/reservations");
    const groupTabs = page.getByRole("navigation", { name: "団体の切り替え" });

    await groupTabs.getByRole("link", { name: groupB.name }).click();
    await expect(rowOf(page, facilityB.name)).toBeVisible();
    await expect(rowOf(page, facilityA.name)).toBeHidden();

    await groupTabs.getByRole("link", { name: groupA.name }).click();
    await expect(rowOf(page, facilityA.name)).toBeVisible();
    await expect(rowOf(page, facilityB.name)).toBeHidden();
  });

  test("状態・期間・施設で絞り込める", async ({ page, db, signInAs }) => {
    // 前提: 1 つの団体に、これからの仮予約・これからの承認済み・過去の承認済みが 1 件ずつある
    const member = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });
    const provisionalFacility = await createFacility(db);
    const approvedFacility = await createFacility(db);
    const pastFacility = await createFacility(db);
    await createReservation(db, {
      groupId: group.id,
      facilityId: provisionalFacility.id,
      createdBy: member.id,
      startAt: nextWeekAt(Weekday.Monday, 10),
      endAt: nextWeekAt(Weekday.Monday, 12),
    });
    await createReservation(db, {
      groupId: group.id,
      facilityId: approvedFacility.id,
      createdBy: member.id,
      startAt: nextWeekAt(Weekday.Tuesday, 10),
      endAt: nextWeekAt(Weekday.Tuesday, 12),
      status: ReservationStatus.Approved,
    });
    await createReservation(db, {
      groupId: group.id,
      facilityId: pastFacility.id,
      createdBy: member.id,
      startAt: lastWeekAt(Weekday.Tuesday, 10),
      endAt: lastWeekAt(Weekday.Tuesday, 12),
      status: ReservationStatus.Approved,
    });
    await signInAs(member.id);

    // 既定は「すべて」の「これからの予約」なので、過去の予約は出ない
    await openPage(page, "/reservations");
    await expect(rowOf(page, provisionalFacility.name)).toBeVisible();
    await expect(rowOf(page, approvedFacility.name)).toBeVisible();
    await expect(rowOf(page, pastFacility.name)).toBeHidden();

    // 状態: 承認済みだけにする
    await page
      .getByRole("navigation", { name: "ステータスの絞り込み" })
      .getByRole("link", { name: /承認済み/ })
      .click();
    await expect(rowOf(page, provisionalFacility.name)).toBeHidden();
    await expect(rowOf(page, approvedFacility.name)).toBeVisible();

    // 期間: 過去の予約に切り替える
    await page.getByRole("combobox", { name: "期間で絞り込み" }).click();
    await page.getByRole("option", { name: "過去の予約" }).click();
    await expect(rowOf(page, pastFacility.name)).toBeVisible();
    await expect(rowOf(page, approvedFacility.name)).toBeHidden();

    // 施設: 絞り込みを外してから、仮予約の施設だけにする
    await openPage(page, "/reservations");
    await page.getByRole("combobox", { name: "施設・設備で絞り込み" }).click();
    await page.getByRole("option", { name: provisionalFacility.name }).click();
    await expect(rowOf(page, provisionalFacility.name)).toBeVisible();
    await expect(rowOf(page, approvedFacility.name)).toBeHidden();
  });
});
