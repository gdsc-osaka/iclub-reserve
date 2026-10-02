import type { Page } from "@playwright/test";

import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import {
  createAuditLog,
  createFacility,
  createGroup,
  createReservation,
  createUser,
} from "../support/factories.js";
import { expect, personas, test } from "../support/fixtures.js";
import { openPage } from "../support/page.js";

/** 一覧のうち、text を含む記録の行 */
const recordOf = (page: Page, text: string) =>
  page.getByRole("list", { name: "操作履歴" }).getByRole("listitem").filter({ hasText: text });

/**
 * UC-024 操作履歴を閲覧する（事務局）（`rdra/contexts/audit-log.md`）
 *
 * 事務局が全件の操作履歴を新しい順に見て、対象の種類・団体・操作者・期間で絞り込む（SCR-018）。
 * 記録の書き込み（COND-013）はまだ無いので、記録はテストの中で直接入れる。
 * 絞り込みの条件ごとの分岐は、Query のテスト（`audit-log-search-sqlite.test.ts`）で押さえている。
 */
test.describe("UC-024 操作履歴を閲覧する（事務局）", { tag: "@UC-024" }, () => {
  test("事務局が操作履歴を見て、団体で絞り込み、予約の記録から予約詳細へ移れる", async ({
    page,
    db,
    signInAs,
  }) => {
    // 前提: この事務局が、2 つの団体それぞれに対して操作した記録がある
    const staff = await createUser(db, { is_staff: true });
    const applicant = await createUser(db);
    const reservedGroup = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Admin }],
    });
    const renamedGroup = await createGroup(db, {
      members: [{ userId: applicant.id, role: MembershipRole.Admin }],
    });
    const facility = await createFacility(db);
    const reservation = await createReservation(db, {
      groupId: reservedGroup.id,
      facilityId: facility.id,
      createdBy: applicant.id,
    });
    await createAuditLog(db, {
      actorId: staff.id,
      actedAsStaff: true,
      action: AuditLogAction.ReservationApprove,
      targetType: AuditLogTargetType.Reservation,
      targetId: reservation.id,
      groupId: reservedGroup.id,
      changes: {
        status: { before: ReservationStatus.Provisional, after: ReservationStatus.Approved },
        status_reason: { before: null, after: null },
      },
    });
    await createAuditLog(db, {
      actorId: staff.id,
      actedAsStaff: true,
      action: AuditLogAction.GroupUpdate,
      targetType: AuditLogTargetType.Group,
      targetId: renamedGroup.id,
      groupId: renamedGroup.id,
      changes: { name: { before: "E2E 変更前の団体名", after: renamedGroup.name } },
    });

    // 他のテストの記録と混ざらないよう、この事務局の操作に絞って開く
    await signInAs(staff.id);
    await openPage(page, `/staff/audit-log?actor=${staff.id}`);

    // 操作者・操作の表示名・「旧 → 新」が見える
    const approval = recordOf(page, facility.name);
    await expect(approval).toContainText(staff.name);
    await expect(approval).toContainText("承認");
    await expect(approval).toContainText("状態: 仮予約 → 承認済み");
    await expect(recordOf(page, renamedGroup.name)).toContainText(
      `名称: E2E 変更前の団体名 → ${renamedGroup.name}`,
    );

    // 団体で絞り込むと、その団体の記録だけになる
    await page.getByRole("combobox", { name: "団体" }).click();
    await page.getByRole("option", { name: reservedGroup.name }).click();
    await page.getByRole("button", { name: "絞り込む" }).click();
    await expect(page).toHaveURL(new RegExp(`group=${reservedGroup.id}`));
    await expect(page.getByRole("list", { name: "操作履歴" }).getByRole("listitem")).toHaveCount(1);
    await expect(recordOf(page, facility.name)).toBeVisible();

    // 予約の記録から予約詳細へ移れる
    await recordOf(page, facility.name)
      .getByRole("link", { name: new RegExp(facility.name) })
      .click();
    await expect(page).toHaveURL(new RegExp(`/reservations/${reservation.id}$`));
  });

  test("事務局でない人が開くと、事務局専用の案内が出る", async ({ page, signInAs }) => {
    await signInAs(personas.groupMember.id);

    await openPage(page, "/staff/audit-log");

    await expect(page.getByText("事務局スタッフ専用ページです")).toBeVisible();
  });

  test("条件に合う記録が無いときは、その旨の案内が出る", async ({ page, db, signInAs }) => {
    // 記録が 1 件も無い団体で絞り込む
    const group = await createGroup(db, { members: [] });
    await signInAs(personas.staff.id);

    await openPage(page, `/staff/audit-log?group=${group.id}`);

    await expect(page.getByText("条件に合う操作履歴はありません。")).toBeVisible();
  });
});
