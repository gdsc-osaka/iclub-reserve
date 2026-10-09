import { createFacility, uniqueSuffix } from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-018 カレンダー購読URLを確認する（`rdra/contexts/calendar-integration.md`）
 *
 * ログイン済みの利用者が施設ごとのカレンダー購読用 URL を確認できる（REQ-030）。
 * ADR-007 の方針に従い、確かめるのは次の 3 点:
 * 1. 主な流れ: 団体のメンバーでログインすると、Calendar ID 付きの施設に「Google カレンダーに追加」のリンク（href が cid= を含む）と iCal の URL が出る
 * 2. 権限の境目: ログインしていないと開けない（ログイン画面へ送られる）
 * 3. 代表的な失敗: Calendar ID の無い施設には「まだ用意されていません」と出て、ボタンが無い
 */
test.describe("UC-018 カレンダー購読URLを確認する", { tag: "@UC-018" }, () => {
  test("団体のメンバーでログインすると、Calendar ID 付きの施設に「Google カレンダーに追加」のリンクと iCal の URL が出る", async ({
    page,
    db,
    signInAs,
  }) => {
    const calendarId = `e2e-calendar-${uniqueSuffix()}@group.calendar.google.com`;
    const calendarUrl = `https://calendar.google.com/calendar/ical/${encodeURIComponent(calendarId)}/public/basic.ics`;
    const facility = await createFacility(db, {
      name: `E2E カレンダーあり施設 ${uniqueSuffix()}`,
      googleCalendarId: calendarId,
      calendarUrl,
    });

    await signInAs(personas.groupMember.id);
    await openPage(page, "/calendars");

    // 施設名が表示されていること
    const facilityHeading = page.getByRole("heading", { name: facility.name });
    await expect(facilityHeading).toBeVisible();

    // 施設カード内のリンク・入力欄を確認
    const card = page.locator('[data-slot="card"]', { has: facilityHeading });

    // 「Google カレンダーに追加」リンクが存在し、href に cid= と Calendar ID が含まれること
    const addLink = card.getByRole("link", { name: "Google カレンダーに追加" });
    await expect(addLink).toBeVisible();
    const href = await addLink.getAttribute("href");
    expect(href).toContain("cid=");
    expect(href).toContain(encodeURIComponent(calendarId));
    expect(await addLink.getAttribute("target")).toBe("_blank");
    expect(await addLink.getAttribute("rel")).toContain("noopener");

    // iCal の URL 入力欄が表示され、正しい URL が入っていること
    const icalInput = card.getByRole("textbox", { name: `${facility.name}のiCal URL` });
    await expect(icalInput).toBeVisible();
    await expect(icalInput).toHaveValue(calendarUrl);
    await expect(card.getByRole("button", { name: "コピー" })).toBeVisible();
  });

  test("ログインしていないと開けず、ログイン画面へ送られる", async ({ page }) => {
    await page.goto("/calendars");
    await expect(page).toHaveURL("/login?redirectTo=%2Fcalendars");
  });

  test("Calendar ID の無い施設には「まだ用意されていません」と出て、ボタンが無い", async ({
    page,
    db,
    signInAs,
  }) => {
    const facility = await createFacility(db, {
      name: `E2E カレンダー未設定施設 ${uniqueSuffix()}`,
      googleCalendarId: null,
      calendarUrl: null,
    });

    await signInAs(personas.groupMember.id);
    await openPage(page, "/calendars");

    const facilityHeading = page.getByRole("heading", { name: facility.name });
    await expect(facilityHeading).toBeVisible();

    const card = page.locator('[data-slot="card"]', { has: facilityHeading });
    await expect(card.getByText("カレンダーはまだ用意されていません")).toBeVisible();
    await expect(card.getByRole("link", { name: "Google カレンダーに追加" })).toBeHidden();
    await expect(card.getByRole("button", { name: "コピー" })).toBeHidden();
  });
});
