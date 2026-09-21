import { describe, expect, it } from "vitest";

import { GroupErrorCode, type GroupError } from "~/domain/group";
import { toActionErrors } from "./action-error";

const errorOf = (code: GroupErrorCode, message: string): GroupError => ({
  code,
  message,
});

describe("toActionErrors", () => {
  it("入力不正（GroupInvalidInput）は、ドメインの文言を nameError に入れ、formError は null になる", () => {
    const errors = toActionErrors(
      errorOf(GroupErrorCode.GroupInvalidInput, "団体名は 64 文字以内で入力してください。"),
    );

    expect(errors.nameError).toBe("団体名は 64 文字以内で入力してください。");
    expect(errors.formError).toBeNull();
  });

  it("権限不足（GroupForbidden）は、ドメインの文言を formError に入れ、nameError は null になる", () => {
    const errors = toActionErrors(
      errorOf(GroupErrorCode.GroupForbidden, "団体情報を編集できるのは管理者と事務局だけです。"),
    );

    expect(errors.nameError).toBeNull();
    expect(errors.formError).toBe("団体情報を編集できるのは管理者と事務局だけです。");
  });

  it("団体が見つからない（GroupNotFound）は、汎用文言を formError に入れ、nameError は null になる", () => {
    const errors = toActionErrors(errorOf(GroupErrorCode.GroupNotFound, "Group not found"));

    expect(errors.nameError).toBeNull();
    expect(errors.formError).toBe("団体が見つかりませんでした。画面を読み込み直してください。");
  });

  it("DB エラー（DatabaseError）は、内部事情を伏せた汎用文言を formError に入れ、nameError は null になる", () => {
    const errors = toActionErrors(
      errorOf(GroupErrorCode.DatabaseError, "Failed to query the database"),
    );

    expect(errors.nameError).toBeNull();
    expect(errors.formError).not.toContain("database");
    expect(errors.formError).toBe("保存できませんでした。時間をおいて、もう一度お試しください。");
  });
});
