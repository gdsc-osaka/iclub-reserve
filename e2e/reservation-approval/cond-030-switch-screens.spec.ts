import { MembershipRole } from "~/domain/membership";
import { nextWeekAt, Weekday } from "../support/dates.js";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
} from "../support/factories.js";
import { expect, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";
import { signInWithCode } from "../support/auth.js";
import { signOutFromMenu } from "../support/account-menu.js";

/**
 * COND-030 画面領域の切り替え（`rdra/contexts/reservation-approval.md`）。
 * 方針は ADR-016（`docs/adr/016-staff-and-user-screens.md`）を参照。
 *
 * UC に属さない画面の仕組みなので、UC の番号ではなく `@COND-030` のタグを付けている。
 */
test.describe("COND-030 画面領域の切り替え", { tag: "@COND-030" }, () => {
  test("事務局でない人には切り替えが出ず、事務局のダッシュボードは開けない", async ({
    page,
    db,
    signInAs,
  }) => {
    const user = await createUser(db);
    await signInAs(user.id);

    await openPage(page, "/");
    const switcher = page.getByRole("navigation", { name: "表示する画面" });
    await expect(switcher).toHaveCount(0);

    const response = await page.goto("/staff");
    expect(response?.status()).toBe(403);
  });

  test("事務局は切り替えで 2 つの画面を行き来でき、画面ごとにナビが変わる", async ({
    page,
    db,
    signInAs,
  }) => {
    const staff = await createUser(db, { is_staff: true });
    await signInAs(staff.id);

    await openPage(page, "/staff");
    const switcher = page.getByRole("navigation", { name: "表示する画面" });
    const staffLink = switcher.getByRole("link", { name: /^事務局/ });
    const userLink = switcher.getByRole("link", { name: /^利用者/ });

    await expect(staffLink).toHaveAttribute("aria-current", "true");
    await expect(userLink).not.toHaveAttribute("aria-current");

    await expect(page.getByRole("link", { name: /^予約の承認(?:\s*（\d+ 件）)?$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "予約", exact: true })).toHaveCount(0);

    await userLink.click();
    await expect(page).toHaveURL("/");
    await expect(userLink).toHaveAttribute("aria-current", "true");
    await expect(staffLink).not.toHaveAttribute("aria-current");

    await expect(page.getByRole("link", { name: "予約", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /^予約の承認(?:\s*（\d+ 件）)?$/ })).toHaveCount(0);

    await staffLink.click();
    await expect(page).toHaveURL("/staff");
    await expect(staffLink).toHaveAttribute("aria-current", "true");
  });

  test("利用者の画面にいる間も、事務局の仕事があれば切り替えに印が出る", async ({
    page,
    db,
    signInAs,
  }) => {
    const applicant = await createUser(db);
    const group = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Member }],
    });
    const facility = await createFacility(db);
    await createReservation(db, {
      groupId: group.id,
      facilityId: facility.id,
      createdBy: applicant.id,
      startAt: nextWeekAt(Weekday.Thursday, 13),
      endAt: nextWeekAt(Weekday.Thursday, 15),
    });

    const staff = await createUser(db, { is_staff: true });
    await signInAs(staff.id);

    await openPage(page, "/");
    const switcher = page.getByRole("navigation", { name: "表示する画面" });
    await expect(
      switcher.getByRole("link", { name: /^事務局\s*（件数のある項目があります）$/ }),
    ).toBeVisible();
  });

  test("どちらでもない画面では、最後に使った画面のナビが出る", async ({ page, db, signInAs }) => {
    const staff = await createUser(db, { is_staff: true });
    await signInAs(staff.id);

    await openPage(page, "/staff");
    await openPage(page, "/account");

    const switcher = page.getByRole("navigation", { name: "表示する画面" });
    const staffLink = switcher.getByRole("link", { name: /^事務局/ });
    const userLink = switcher.getByRole("link", { name: /^利用者/ });

    await expect(staffLink).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("link", { name: /^予約の承認(?:\s*（\d+ 件）)?$/ })).toBeVisible();

    await openPage(page, "/");
    await openPage(page, "/account");

    await expect(userLink).toHaveAttribute("aria-current", "true");
  });

  test("事務局がログインすると、初めては事務局の画面、前回利用者の画面を使っていれば利用者の画面のダッシュボードが開く", async ({
    page,
    db,
    isMobile,
  }) => {
    const staff = await createUser(db, { is_staff: true });

    await openPage(page, "/login");
    await signInWithCode(page, db, staff.email);
    await expect(page).toHaveURL("/staff");

    await openPage(page, "/");
    await signOutFromMenu(page, isMobile, staff.email);
    await expect(page).toHaveURL("/login");

    await signInWithCode(page, db, staff.email);
    await expect(page).toHaveURL("/");
  });
});
