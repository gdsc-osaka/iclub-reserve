import { describe, expect, it } from "vitest";

import {
  toStaffRoleAcceptAuditLog,
  toStaffRoleCancelInvitationAuditLog,
  toStaffRoleDeclineAuditLog,
  toStaffRoleInviteAuditLog,
  toStaffRoleRevokeAuditLog,
} from "./audit-log";

describe("事務局権限の操作履歴（audit-log）", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  it("#25 staff_role.invite: 作成の記録（email）が組み立てられる", () => {
    const draft = toStaffRoleInviteAuditLog("sinv_1", "new_staff@example.com", "usr_actor", now);

    expect(draft).toEqual({
      occurredAt: now,
      actorId: "usr_actor",
      actedAsStaff: true,
      action: "staff_role.invite",
      targetId: "sinv_1",
      groupId: null,
      changes: {
        email: { before: null, after: "new_staff@example.com" },
      },
    });
  });

  it("#26 staff_role.cancel_invitation: 取り消しの記録（email, status）が組み立てられる", () => {
    const draft = toStaffRoleCancelInvitationAuditLog(
      "sinv_1",
      "staff@example.com",
      "usr_actor",
      now,
    );

    expect(draft).toEqual({
      occurredAt: now,
      actorId: "usr_actor",
      actedAsStaff: true,
      action: "staff_role.cancel_invitation",
      targetId: "sinv_1",
      groupId: null,
      changes: {
        email: { before: "staff@example.com", after: "staff@example.com" },
        status: { before: "pending", after: "canceled" },
      },
    });
  });

  it("#27 staff_role.accept: 承諾の記録（is_staff, staff_invitation_id）が組み立てられ、targetId は承諾者本人", () => {
    const draft = toStaffRoleAcceptAuditLog(
      {
        invitationId: "sinv_1",
        userId: "usr_invitee",
        actorIsStaff: false,
      },
      now,
    );

    expect(draft).toEqual({
      occurredAt: now,
      actorId: "usr_invitee",
      actedAsStaff: true,
      action: "staff_role.accept",
      targetId: "usr_invitee",
      groupId: null,
      changes: {
        is_staff: { before: false, after: true },
        staff_invitation_id: { before: "sinv_1", after: "sinv_1" },
      },
    });
  });

  it("#28 staff_role.decline: 辞退の記録（email, status）が組み立てられる", () => {
    const draft = toStaffRoleDeclineAuditLog("sinv_1", "invitee@example.com", "usr_invitee", now);

    expect(draft).toEqual({
      occurredAt: now,
      actorId: "usr_invitee",
      actedAsStaff: true,
      action: "staff_role.decline",
      targetId: "sinv_1",
      groupId: null,
      changes: {
        email: { before: "invitee@example.com", after: "invitee@example.com" },
        status: { before: "pending", after: "rejected" },
      },
    });
  });

  it("#29 staff_role.revoke: 剥奪の記録（is_staff: true -> false）が組み立てられ、targetId は剥奪された人", () => {
    const draft = toStaffRoleRevokeAuditLog("usr_target", "usr_actor", now);

    expect(draft).toEqual({
      occurredAt: now,
      actorId: "usr_actor",
      actedAsStaff: true,
      action: "staff_role.revoke",
      targetId: "usr_target",
      groupId: null,
      changes: {
        is_staff: { before: true, after: false },
      },
    });
  });
});
