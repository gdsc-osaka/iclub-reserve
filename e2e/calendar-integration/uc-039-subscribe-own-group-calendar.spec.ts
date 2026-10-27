import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import {
  createFacility,
  createGroup,
  createReservation,
  createUser,
  uniqueSuffix,
} from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/**
 * UC-039 自団体の予約のカレンダーを購読する（`rdra/contexts/calendar-integration.md`）
 *
 * 団体のメンバーが自分専用の購読 URL を発行・確認・作り直しできる（REQ-050 / COND-029 / ADR-013）。
 * ADR-007 の方針に従い、確かめるのは次の 3 点:
 * 1. 主な流れ: 団体のメンバーでログイン → 団体管理画面（`/groups/<groupId>`）で「購読 URL を発行」を押す →
 *    発行された URL を HTTP で取得すると自団体の仮予約・承認済み予約が含まれ、他団体の予約は含まれない
 * 2. 作り直し: 「URL を作り直す」を実行すると、古い URL は 0 件（無効カレンダー）になり、新しい URL に予約が載る
 * 3. 権限の境目: 所属していない事務局がその団体を開いた場合、カレンダー購読カード自体が表示されない
 */
test.describe("UC-039 自団体の予約のカレンダーを購読する", { tag: "@UC-039" }, () => {
  test("団体のメンバーが購読 URL を発行して予約を取得でき、作り直すと古い URL は無効化される", async ({
    page,
    db,
    signInAs,
    request,
  }) => {
    const member = await createUser(db, { name: `メンバー ${uniqueSuffix()}` });
    const myGroup = await createGroup(db, {
      name: `自団体 ${uniqueSuffix()}`,
      members: [{ userId: member.id, role: MembershipRole.Member }],
    });

    const otherMember = await createUser(db);
    const otherGroup = await createGroup(db, {
      name: `他団体 ${uniqueSuffix()}`,
      members: [{ userId: otherMember.id, role: MembershipRole.Member }],
    });

    const myFacility = await createFacility(db, { name: `自施設 ${uniqueSuffix()}` });
    const otherFacility = await createFacility(db, { name: `他施設 ${uniqueSuffix()}` });

    const now = Date.now();
    const startAt1 = new Date(now + 24 * 60 * 60 * 1000);
    const endAt1 = new Date(startAt1.getTime() + 2 * 60 * 60 * 1000);

    const startAt2 = new Date(now + 48 * 60 * 60 * 1000);
    const endAt2 = new Date(startAt2.getTime() + 2 * 60 * 60 * 1000);

    // 自団体の仮予約
    await createReservation(db, {
      groupId: myGroup.id,
      facilityId: myFacility.id,
      createdBy: member.id,
      status: ReservationStatus.Provisional,
      startAt: startAt1,
      endAt: endAt1,
      headCount: 6,
      note: "自団体の仮予約の備考です",
    });

    // 自団体の承認済み予約
    await createReservation(db, {
      groupId: myGroup.id,
      facilityId: myFacility.id,
      createdBy: member.id,
      status: ReservationStatus.Approved,
      startAt: startAt2,
      endAt: endAt2,
      headCount: 8,
      note: null,
    });

    // 他団体の承認済み予約
    await createReservation(db, {
      groupId: otherGroup.id,
      facilityId: otherFacility.id,
      createdBy: otherMember.id,
      status: ReservationStatus.Approved,
      startAt: startAt1,
      endAt: endAt1,
      headCount: 10,
    });

    // 1. 団体のメンバーでログインして団体管理画面へ遷移
    await signInAs(member.id);
    await openPage(page, `/groups/${myGroup.id}`);

    // カレンダー購読カードの表示確認
    const cardHeading = page.getByRole("heading", { name: "予約をカレンダーで見る" });
    await expect(cardHeading).toBeVisible();

    // 未発行時は「購読 URL を発行」ボタンが表示されている
    const issueButton = page.getByRole("button", { name: "購読 URL を発行" });
    await expect(issueButton).toBeVisible();

    // 2. URL を発行する
    await issueButton.click();

    // 発行後は「URL を作り直す」ボタンおよび URL 入力欄が表示される
    const regenerateTrigger = page.getByRole("button", { name: "URL を作り直す" });
    await expect(regenerateTrigger).toBeVisible();

    const urlInput = page.getByRole("textbox", {
      name: "購読 URL（Apple カレンダー・Outlook など）",
    });
    await expect(urlInput).toBeVisible();
    const feedUrl = await urlInput.inputValue();
    expect(feedUrl).toContain("/calendar-feeds/");
    expect(feedUrl.endsWith(".ics")).toBe(true);

    // 発行された URL を Playwright の request で取得して検証
    const feedResponse = await request.get(feedUrl);
    expect(feedResponse.status()).toBe(200);
    expect(feedResponse.headers()["content-type"]).toContain("text/calendar");

    const feedIcs = await feedResponse.text();
    // RFC 5545 の折り返し（CRLF + 空白）を解除して検証する
    const unfoldedFeedIcs = feedIcs.replace(/\r?\n[ \t]/g, "");
    // 自団体の仮予約（接頭辞付き）と承認済み予約が含まれる
    expect(unfoldedFeedIcs).toContain(`[仮予約] ${myFacility.name}`);
    expect(unfoldedFeedIcs).toContain(`SUMMARY:${myFacility.name}`);
    expect(unfoldedFeedIcs).toContain("使用人数: 6 人");
    expect(unfoldedFeedIcs).toContain("備考: 自団体の仮予約の備考です");
    expect(unfoldedFeedIcs).toContain("使用人数: 8 人");
    // 他団体の予約は含まれない
    expect(unfoldedFeedIcs).not.toContain(otherFacility.name);

    // 3. URL を作り直す
    await regenerateTrigger.click();

    // 確認ダイアログが表示される
    const alertDialog = page.getByRole("alertdialog");
    await expect(alertDialog).toBeVisible();
    await expect(alertDialog.getByText("購読 URL を作り直しますか？")).toBeVisible();

    // ダイアログ内の「作り直す」ボタンを押す
    const confirmRegenerateButton = alertDialog.getByRole("button", { name: "作り直す" });
    await confirmRegenerateButton.click();

    // 新しい URL に更新されること
    await expect(urlInput).not.toHaveValue(feedUrl);
    const newFeedUrl = await urlInput.inputValue();
    expect(newFeedUrl).toContain("/calendar-feeds/");
    expect(newFeedUrl).not.toBe(feedUrl);

    // 古い URL を取得すると 200 で 0 件（無効カレンダー）が返る
    const oldFeedResponse = await request.get(feedUrl);
    expect(oldFeedResponse.status()).toBe(200);
    const oldFeedIcs = await oldFeedResponse.text();
    const unfoldedOldIcs = oldFeedIcs.replace(/\r?\n[ \t]/g, "");
    expect(unfoldedOldIcs).toContain("無効になったカレンダー（i-Club）");
    expect(unfoldedOldIcs).not.toContain("BEGIN:VEVENT");

    // 新しい URL を取得すると予約情報が返る
    const newFeedResponse = await request.get(newFeedUrl);
    expect(newFeedResponse.status()).toBe(200);
    const newFeedIcs = await newFeedResponse.text();
    const unfoldedNewIcs = newFeedIcs.replace(/\r?\n[ \t]/g, "");
    expect(unfoldedNewIcs).toContain(`[仮予約] ${myFacility.name}`);
    expect(unfoldedNewIcs).toContain(`SUMMARY:${myFacility.name}`);
  });

  test("所属していない事務局スタッフが団体管理画面を開いた場合、カレンダー購読カードは表示されない", async ({
    page,
    db,
    signInAs,
  }) => {
    const owner = await createUser(db);
    const group = await createGroup(db, {
      name: `事務局が所属しない団体 ${uniqueSuffix()}`,
      members: [{ userId: owner.id, role: MembershipRole.Admin }],
    });

    await signInAs(personas.staff.id);
    await openPage(page, `/staff/groups/${group.id}`);

    // 団体情報カードなどは表示されるが、カレンダー購読カードは表示されない
    await expect(page.getByRole("heading", { name: group.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "予約をカレンダーで見る" })).toBeHidden();
  });
});
