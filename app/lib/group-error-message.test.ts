import { describe, expect, it } from "vitest";

import { GroupErrorCode, type GroupError } from "~/domain/group";
import { toGroupErrorMessage } from "./group-error-message";

const errorOf = (code: GroupErrorCode, message: string): GroupError => ({
  code,
  message,
});

describe("toGroupErrorMessage", () => {
  it("入力不正（GroupInvalidInput）はドメインの文言をそのまま返す", () => {
    const msg = toGroupErrorMessage(
      errorOf(GroupErrorCode.GroupInvalidInput, "指定できない役割です。"),
    );
    expect(msg).toBe("指定できない役割です。");
  });

  it("権限不足（GroupForbidden）はドメインの文言をそのまま返す", () => {
    const msg = toGroupErrorMessage(
      errorOf(
        GroupErrorCode.GroupForbidden,
        "メンバーの役割を変更できるのは管理者と事務局だけです。",
      ),
    );
    expect(msg).toBe("メンバーの役割を変更できるのは管理者と事務局だけです。");
  });

  it("最後の管理者保護（LastAdminRequired）はドメインの文言をそのまま返す", () => {
    const msg = toGroupErrorMessage(
      errorOf(
        GroupErrorCode.LastAdminRequired,
        "管理者が 0 人になるため、最後の管理者は降格できません。先に別のメンバーを管理者にしてください。",
      ),
    );
    expect(msg).toBe(
      "管理者が 0 人になるため、最後の管理者は降格できません。先に別のメンバーを管理者にしてください。",
    );
  });

  it("メンバーが見つからない（MemberNotFound）は汎用案内文言を返す", () => {
    const msg = toGroupErrorMessage(
      errorOf(GroupErrorCode.MemberNotFound, "対象のメンバーはこの団体に所属していません。"),
    );
    expect(msg).toBe("対象のメンバーが見つかりませんでした。画面を読み込み直してください。");
  });

  it("招待が見つからない（InvitationNotFound）は汎用案内文言を返す", () => {
    const msg = toGroupErrorMessage(
      errorOf(
        GroupErrorCode.InvitationNotFound,
        "対象の招待が見つかりません。すでに取り消されたか、承諾された可能性があります。",
      ),
    );
    expect(msg).toBe("対象の招待が見つかりませんでした。画面を読み込み直してください。");
  });

  it("団体が見つからない（GroupNotFound）は汎用案内文言を返す", () => {
    const msg = toGroupErrorMessage(errorOf(GroupErrorCode.GroupNotFound, "Group not found"));
    expect(msg).toBe("団体が見つかりませんでした。画面を読み込み直してください。");
  });

  it("DB エラー（DatabaseError）は内部事情を伏せた汎用文言を返す", () => {
    const msg = toGroupErrorMessage(
      errorOf(GroupErrorCode.DatabaseError, "Failed to connect to SQLite D1"),
    );
    expect(msg).not.toContain("SQLite");
    expect(msg).toBe("保存できませんでした。時間をおいて、もう一度お試しください。");
  });
});
