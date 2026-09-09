import { hasPermission } from "better-auth/plugins/organization";
import { defaultStatements } from "better-auth/plugins/organization/access";
import { describe, expect, it } from "vitest";

import { MembershipRole } from "~/domain/membership";
import { ac, admin, member } from "./permission";

/**
 * このテストの目的は、ドメインの権限表 (app/domain/group.ts) と
 * Better Auth の認可が食い違わないことを確かめること。
 *
 * permission.ts の toStatements を再実装して比べても、同じ計算を 2 回書くだけで
 * 何も検証できない。そこで「Better Auth の各エンドポイントが実際に投げる権限」と
 * 「Better Auth 自身の判定関数」を使って、外から見える振る舞いを固定する。
 */

/** 各エンドポイントが認可に使う権限。コメントは対応する Better Auth の処理 */
const permissions = {
  /** updateOrganization */
  updateOrganization: { organization: ["update"] },
  /** deleteOrganization */
  deleteOrganization: { organization: ["delete"] },
  /** createInvitation */
  createInvitation: { invitation: ["create"] },
  /** cancelInvitation */
  cancelInvitation: { invitation: ["cancel"] },
  /** removeMember */
  removeMember: { member: ["delete"] },
  /** updateMemberRole */
  updateMemberRole: { member: ["update"] },
} as const;

describe("admin ロール", () => {
  it("グループ情報を編集できる", () => {
    expect(admin.authorize(permissions.updateOrganization).success).toBe(true);
  });

  it("メンバーを招待できる", () => {
    expect(admin.authorize(permissions.createInvitation).success).toBe(true);
    expect(admin.authorize(permissions.cancelInvitation).success).toBe(true);
  });

  it("グループを削除できない", () => {
    // 予約が紐づくグループの物理削除は外部キー違反になるため、意図的に許可していない
    expect(admin.authorize(permissions.deleteOrganization).success).toBe(false);
  });

  it("メンバーの追放と役割変更ができる", () => {
    expect(admin.authorize(permissions.removeMember).success).toBe(true);
    expect(admin.authorize(permissions.updateMemberRole).success).toBe(true);
  });
});

describe("member ロール", () => {
  it("グループ情報を編集できない", () => {
    expect(member.authorize(permissions.updateOrganization).success).toBe(false);
  });

  it("メンバーを招待できない", () => {
    expect(member.authorize(permissions.createInvitation).success).toBe(false);
  });

  it("メンバーの追放と役割変更ができない", () => {
    expect(member.authorize(permissions.removeMember).success).toBe(false);
    expect(member.authorize(permissions.updateMemberRole).success).toBe(false);
  });
});

describe("Better Auth による役割文字列の解釈", () => {
  /** Better Auth の組織プラグインに渡している設定と同じもの */
  const options = { ac, roles: { admin, member }, creatorRole: MembershipRole.Admin };

  const canUpdateOrganization = (role: string): Promise<boolean> =>
    hasPermission(
      { role, options, permissions: { organization: ["update"] }, organizationId: "grp_test" },
      // ctx は動的な役割 (dynamicAccessControl) を有効にしたときだけ参照される。
      // 有効にしていないので実際には使われないが、型の上では必須なので undefined を渡す
      undefined as never,
    );

  it.each([
    ["admin", true],
    ["member", false],
    // Better Auth は複数の役割をカンマ区切りで持ち、いずれかが許可すれば許可する
    ["admin,member", true],
    ["member,admin", true],
    // roles に登録していない役割はすべて拒否される
    ["owner", false],
    ["", false],
  ])("役割が %o のとき、グループ情報を編集できるかは %o になる", async (role, allowed) => {
    await expect(canUpdateOrganization(role)).resolves.toBe(allowed);
  });
});

describe("Better Auth の statement 一覧との対応", () => {
  it("ロールが Better Auth の全 statement を網羅している", () => {
    // Better Auth 側に statement が増えたらここで気づけるようにする
    expect(Object.keys(admin.statements).sort()).toEqual(Object.keys(defaultStatements).sort());
    expect(Object.keys(member.statements).sort()).toEqual(Object.keys(defaultStatements).sort());
  });
});
