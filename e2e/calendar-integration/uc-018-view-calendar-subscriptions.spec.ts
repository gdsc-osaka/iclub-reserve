import { createFacility, uniqueSuffix } from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-018 カレンダー購読URLを確認する（`rdra/contexts/calendar-integration.md`）
 *
 * 事務局スタッフが施設ごとのカレンダー購読用 URL を確認できる（REQ-030 / ADR-013 決定 7）。
 * ADR-007 の方針に従い、確かめるのは次の 3 点:
 * 1. 主な流れ: 事務局スタッフでログインすると、Calendar ID 付きの施設に「Google カレンダーに追加」のリンク（href が cid= を含む）と iCal の URL が出る
 * 2. 権限の境目: 事務局でない利用者は開けず権限エラーになる。また未ログインだとログイン画面へ送られる
 * 3. 代表的な失敗: Calendar ID の無い施設には「まだ用意されていません」と出て、ボタンが無い
 */
test.describe("UC-018 カレンダー購読URLを確認する", { tag: "@UC-018" }, () => {
  test("事務局スタッフでログインすると、Calendar ID 付きの施設に「Google カレンダーに追加」のリンクと iCal の URL が出る", async ({
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

    await signInAs(personas.staff.id);
    await openPage(page, "/staff/calendars");

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

  test("事務局でない利用者は開けず権限エラーになり、ログインしていないとログイン画面へ送られる", async ({
    page,
    signInAs,
  }) => {
    // ログインしていないとき
    await page.goto("/staff/calendars");
    await expect(page).toHaveURL("/login?redirectTo=%2Fstaff%2Fcalendars");

    // 事務局でない利用者がアクセスしたとき
    await signInAs(personas.groupMember.id);
    const response = await page.goto("/staff/calendars");
    expect(response?.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "エラーが発生しました" })).toBeVisible();
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

    await signInAs(personas.staff.id);
    await openPage(page, "/staff/calendars");

    const facilityHeading = page.getByRole("heading", { name: facility.name });
    await expect(facilityHeading).toBeVisible();

    const card = page.locator('[data-slot="card"]', { has: facilityHeading });
    await expect(card.getByText("カレンダーはまだ用意されていません")).toBeVisible();
    await expect(card.getByRole("link", { name: "Google カレンダーに追加" })).toBeHidden();
    await expect(card.getByRole("button", { name: "コピー" })).toBeHidden();
  });
});
