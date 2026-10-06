import { describe, expect, it } from "vitest";
import { canAct } from "../membership";
import {
  StaffAction,
  StaffErrorCode,
  StaffField,
  staffInvitationAcceptPath,
  staffPermissions,
  validateStaffInvitationEmail,
  wouldRemoveLastStaff,
} from "./index";

describe("wouldRemoveLastStaff", () => {
  it("事務局が 2 人以上残る場合は false を返す", () => {
    expect(wouldRemoveLastStaff(3)).toBe(false);
    expect(wouldRemoveLastStaff(2)).toBe(false);
  });

  it("事務局が 1 人以下になる場合は true を返す", () => {
    expect(wouldRemoveLastStaff(1)).toBe(true);
    expect(wouldRemoveLastStaff(0)).toBe(true);
  });
});

describe("staffPermissions", () => {
  it("事務局スタッフにはすべての操作が許可される", () => {
    const actor = { isStaff: true, membership: null };
    expect(canAct(staffPermissions, actor, StaffAction.ViewManagement)).toBe(true);
    expect(canAct(staffPermissions, actor, StaffAction.Invite)).toBe(true);
    expect(canAct(staffPermissions, actor, StaffAction.CancelInvitation)).toBe(true);
    expect(canAct(staffPermissions, actor, StaffAction.Revoke)).toBe(true);
  });

  it("一般ユーザーにはすべての操作が拒否される", () => {
    const actor = { isStaff: false, membership: null };
    expect(canAct(staffPermissions, actor, StaffAction.ViewManagement)).toBe(false);
    expect(canAct(staffPermissions, actor, StaffAction.Invite)).toBe(false);
    expect(canAct(staffPermissions, actor, StaffAction.CancelInvitation)).toBe(false);
    expect(canAct(staffPermissions, actor, StaffAction.Revoke)).toBe(false);
  });
});

describe("staffInvitationAcceptPath", () => {
  it("正しい承諾画面パスを返す", () => {
    expect(staffInvitationAcceptPath("inv_123")).toBe("/staff-invitations/inv_123");
  });
});

describe("validateStaffInvitationEmail", () => {
  it("有効な osaka-u.ac.jp メールアドレスを正規化して返す", () => {
    const result = validateStaffInvitationEmail(" Test@Osaka-U.ac.jp ");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("test@osaka-u.ac.jp");
    }
  });

  it("サブドメインのアドレスも許可する", () => {
    const result = validateStaffInvitationEmail("user@ecs.osaka-u.ac.jp");
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBe("user@ecs.osaka-u.ac.jp");
    }
  });

  it("空文字の場合は StaffError を返す", () => {
    const result = validateStaffInvitationEmail("");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvalidInput);
      expect(result.error.field).toBe(StaffField.Email);
    }
  });

  it("他大学ドメインのアドレスは拒否する", () => {
    const result = validateStaffInvitationEmail("user@kyoto-u.ac.jp");
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe(StaffErrorCode.InvalidInput);
      expect(result.error.field).toBe(StaffField.Email);
      expect(result.error.userMessage).toContain("osaka-u.ac.jp");
    }
  });
});
