import { expect, type Locator, type Page } from "@playwright/test";

/**
 * 空き状況カレンダー（SCR-001）の「新しい予約」「予約の変更」の欄を操作・確認する補助関数。
 *
 * スマホ（幅 `md` 未満）では 2 段階に分かれるため、PC と操作手順が異なる（ADR-014 決定 12・13）。
 * - 選ぶ段階: カレンダーの下にバー（日時の文字・「次へ」・「日時を入力する」）だけを出す。
 * - 入力する段階: カレンダーを隠し、団体・使用人数・備考・「内容を確認する」と「カレンダーで選び直す」を出す。
 * - 申請は選ぶ段階から、変更は入力する段階から始まる。
 *
 * 画面幅による分岐を各 spec に書き散らさず、Playwright の `isMobile` に応じてここで吸収する。
 */

/**
 * スマホなら「次へ」を押して入力する段階へ進む（PC では何もしない）。
 *
 * 申請（`新しい予約`）はスマホでは選ぶ段階から始まるため、使用人数・備考・解錠の手配や
 * 申請の案内文・「内容を確認する」を操作・確認する前にこの関数で入力する段階へ進める（ADR-014 決定 13）。
 * 遷移が終わるまで「カレンダーで選び直す」ボタンの表示を待つ。
 */
export async function proceedToAvailabilityInputStep(
  panel: Locator,
  isMobile: boolean,
): Promise<void> {
  if (!isMobile) return;
  await panel.getByRole("button", { name: "次へ" }).click();
  await expect(panel.getByRole("button", { name: "カレンダーで選び直す" })).toBeVisible();
}

/**
 * スマホなら「カレンダーで選び直す」を押して選ぶ段階へ戻る（PC では何もしない）。
 *
 * スマホの入力する段階ではカレンダー（施設・設備の切り替えや「今日」ボタンを含む）と
 * 時刻の入力欄が隠れるため、施設を切り替えたりカレンダーを動かしたりする前に戻す（ADR-014 決定 13）。
 * 遷移が終わるまでバーの「日時を入力する」ボタンの表示を待つ。
 */
export async function repickOnAvailabilityCalendar(
  panel: Locator,
  isMobile: boolean,
): Promise<void> {
  if (!isMobile) return;
  await panel.getByRole("button", { name: "カレンダーで選び直す" }).click();
  await expect(panel.getByRole("button", { name: "日時を入力する" })).toBeVisible();
}

/**
 * 欄の「開始時刻」「終了時刻」の選択欄（combobox）で時間帯を選ぶ。
 *
 * - PC: 欄の中に常に出ている「開始時刻」「終了時刻」の combobox を開いて選ぶ。
 * - スマホ: 入力する段階にいる場合は「カレンダーで選び直す」で選ぶ段階へ戻り、
 *   「日時を入力する」が閉じていれば開いてからバー内の combobox で選び（ADR-014 決定 12）、
 *   `proceed` が false でなければ「次へ」で入力する段階へ進む（ADR-014 決定 13）。
 *   承認済みと重なる時間帯を選んで「次へ」が押せなくなることを確かめるときは `proceed: false` を渡す。
 */
export async function selectAvailabilityTimeRange(
  page: Page,
  panel: Locator,
  isMobile: boolean,
  options: {
    readonly start?: string;
    readonly end?: string;
    readonly proceed?: boolean;
  },
): Promise<void> {
  if (isMobile) {
    if (await panel.getByRole("button", { name: "カレンダーで選び直す" }).isVisible()) {
      await repickOnAvailabilityCalendar(panel, isMobile);
    }

    const toggle = panel.getByRole("button", { name: "日時を入力する" });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") {
      await toggle.click();
    }
  }

  if (options.start !== undefined) {
    const startCombobox = panel.getByRole("combobox", { name: "開始時刻" });
    await startCombobox.click();
    await page.getByRole("option", { name: options.start }).click();
    await expect(startCombobox).toHaveText(options.start);
  }

  if (options.end !== undefined) {
    const endCombobox = panel.getByRole("combobox", { name: "終了時刻" });
    await endCombobox.click();
    await page.getByRole("option", { name: options.end }).click();
    await expect(endCombobox).toHaveText(options.end);
  }

  if (isMobile && options.proceed !== false) {
    await proceedToAvailabilityInputStep(panel, isMobile);
  }
}

/**
 * 欄に表示されている時間帯が期待どおりであることを確かめる。
 *
 * - PC: 「開始時刻」「終了時刻」の combobox の値を確かめる。
 * - スマホ: 「日時を入力する」を開くと欄が高くなってカレンダーが狭まるため、
 *   バーまたは入力段階に出ている日時の文字（`10:00〜11:00` の形）で確かめる（ADR-014 決定 13）。
 */
export async function expectAvailabilityTimeRange(
  panel: Locator,
  isMobile: boolean,
  range: { readonly start: string; readonly end: string },
): Promise<void> {
  if (isMobile) {
    // 同じ日時の文字は選ぶ段階のバーと入力する段階の日時の行の両方にあり、片方は隠れているため、見えている方だけを確かめる
    await expect(
      panel.getByText(new RegExp(`${range.start}〜${range.end}`)).filter({ visible: true }),
    ).toBeVisible();
    return;
  }

  await expect(panel.getByRole("combobox", { name: "開始時刻" })).toHaveText(range.start);
  await expect(panel.getByRole("combobox", { name: "終了時刻" })).toHaveText(range.end);
}

/**
 * 承認済みの予約と重なる時間帯を選んだときに、先へ進めず警告が出ることを確かめる。
 *
 * - PC: 欄内に「この時間帯はすでに埋まっています」が出て、確認ボタンが押せない。
 * - スマホ: 選ぶ段階のバーに「承認済みの予約と重なっています。」が出て、「次へ」が押せない（ADR-014 決定 13）。
 */
export async function expectAvailabilityBlocked(
  panel: Locator,
  isMobile: boolean,
  confirmButtonName: "内容を確認する" | "変更内容を確認する",
): Promise<void> {
  if (isMobile) {
    await expect(panel.getByText("承認済みの予約と重なっています。")).toBeVisible();
    await expect(panel.getByRole("button", { name: "次へ" })).toBeDisabled();
    return;
  }

  await expect(panel.getByText("この時間帯はすでに埋まっています")).toBeVisible();
  await expect(panel.getByRole("button", { name: confirmButtonName })).toBeDisabled();
}
