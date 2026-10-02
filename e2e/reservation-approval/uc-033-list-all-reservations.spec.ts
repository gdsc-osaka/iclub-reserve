import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
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
 * UC-033 全団体の予約一覧を確認する（事務局）（`rdra/contexts/reservation-approval.md`）
 *
 * 事務局の予約一覧には、ほかのテストで作った予約も並ぶ。
 * そこで、このテストで作った予約だけを施設の名前で探し、互いの順番を比べる。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

test.describe("UC-033 全団体の予約一覧を確認する（事務局）", { tag: "@UC-033" }, () => {
  test("既定では、全団体の仮予約が申請の古い順に並ぶ", async ({ page, db, signInAs }) => {
    // 前提: 2 つの団体が仮予約を 1 件ずつ申請している。
    // 先に申請したほうを、利用日は後にしておく（利用日の順ではなく申請の順に並ぶことを確かめるため）
    const applicantA = await createUser(db);
    const groupA = await createGroup(db, {
      members: [{ userId: applicantA.id, role: MembershipRole.Member }],
    });
    const applicantB = await createUser(db);
    const groupB = await createGroup(db, {
      members: [{ userId: applicantB.id, role: MembershipRole.Member }],
    });
    const earlierFacility = await createFacility(db);
    const laterFacility = await createFacility(db);
    const approvedFacility = await createFacility(db);
    await createReservation(db, {
      groupId: groupA.id,
      facilityId: earlierFacility.id,
      createdBy: applicantA.id,
      startAt: nextWeekAt(Weekday.Friday, 10),
      endAt: nextWeekAt(Weekday.Friday, 12),
      createdAt: new Date(Date.now() - 2 * DAY_MS),
    });
    await createReservation(db, {
      groupId: groupB.id,
      facilityId: laterFacility.id,
      createdBy: applicantB.id,
      startAt: nextWeekAt(Weekday.Monday, 10),
      endAt: nextWeekAt(Weekday.Monday, 12),
      createdAt: new Date(Date.now() - 1 * DAY_MS),
    });
    // 承認済みの予約は、既定の一覧には出ない
    await createReservation(db, {
      groupId: groupA.id,
      facilityId: approvedFacility.id,
      createdBy: applicantA.id,
      startAt: nextWeekAt(Weekday.Tuesday, 10),
      endAt: nextWeekAt(Weekday.Tuesday, 12),
      status: ReservationStatus.Approved,
    });

    await signInAs(personas.staff.id);
    await openPage(page, "/staff/reservations");

    // どちらの団体の仮予約も、団体名つきで並ぶ
    const earlierRow = page.getByRole("listitem").filter({ hasText: earlierFacility.name });
    const laterRow = page.getByRole("listitem").filter({ hasText: laterFacility.name });
    await expect(earlierRow.getByText(groupA.name)).toBeVisible();
    await expect(laterRow.getByText(groupB.name)).toBeVisible();
    await expect(
      page.getByRole("listitem").filter({ hasText: approvedFacility.name }),
    ).toBeHidden();

    // 先に申請したほうが上に来る
    const rowTexts = await page.getByRole("listitem").allInnerTexts();
    const earlierIndex = rowTexts.findIndex((text) => text.includes(earlierFacility.name));
    const laterIndex = rowTexts.findIndex((text) => text.includes(laterFacility.name));
    expect(earlierIndex).toBeLessThan(laterIndex);
  });

  test("事務局でない人は、事務局の予約一覧を開けない", async ({ page, db, signInAs }) => {
    const member = await createUser(db);
    await createGroup(db, { members: [{ userId: member.id, role: MembershipRole.Admin }] });
    await signInAs(member.id);

    const response = await page.goto("/staff/reservations");

    expect(response?.status()).toBe(403);
    await expect(page.getByText("事務局スタッフ専用ページです")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "ステータスの絞り込み" })).toBeHidden();
  });
});
