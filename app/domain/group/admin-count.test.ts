import { describe, expect, it } from "vitest";

import { wouldRemoveLastAdmin } from "./admin-count";

describe("wouldRemoveLastAdmin", () => {
  it("管理者が 2 人いるとき、管理者 1 人を降格（または削除）しても管理者が残るため false", () => {
    // 降格: targetIsAdmin: true, targetStaysAdmin: false
    const result = wouldRemoveLastAdmin({
      adminCount: 2,
      targetIsAdmin: true,
      targetStaysAdmin: false,
    });

    expect(result).toBe(false);
  });

  it("管理者が 1 人のとき、その 1 人を降格すると管理者が 0 人になるため true", () => {
    const result = wouldRemoveLastAdmin({
      adminCount: 1,
      targetIsAdmin: true,
      targetStaysAdmin: false,
    });

    expect(result).toBe(true);
  });

  it("管理者が 1 人のとき、管理者でない人を降格・削除しても管理者数は変わらないため false", () => {
    // 一般メンバーの削除: targetIsAdmin: false, targetStaysAdmin: false
    const result = wouldRemoveLastAdmin({
      adminCount: 1,
      targetIsAdmin: false,
      targetStaysAdmin: false,
    });

    expect(result).toBe(false);
  });

  it("管理者でない人を管理者にする（昇格）ときは、人数が増えるため常に false", () => {
    // 管理者 0 人の場合でも昇格なら 1 人になるので false
    expect(
      wouldRemoveLastAdmin({
        adminCount: 0,
        targetIsAdmin: false,
        targetStaysAdmin: true,
      }),
    ).toBe(false);

    // 管理者 1 人から 2 人への昇格
    expect(
      wouldRemoveLastAdmin({
        adminCount: 1,
        targetIsAdmin: false,
        targetStaysAdmin: true,
      }),
    ).toBe(false);
  });

  it("管理者が 1 人で、その 1 人を対象にしつつ管理者のままにする（変更なし）ときは false", () => {
    const result = wouldRemoveLastAdmin({
      adminCount: 1,
      targetIsAdmin: true,
      targetStaysAdmin: true,
    });

    expect(result).toBe(false);
  });

  it("管理者が 0 人の破損状態でも、管理者でない人の削除によって true にはならない（減らす操作のみを抑止）", () => {
    // 既に管理者が 0 人の状態であっても、一般メンバーの削除（管理者を減らさない操作）を
    // この関数の責務として巻き込んで止めてしまわないことを確認する。
    const result = wouldRemoveLastAdmin({
      adminCount: 0,
      targetIsAdmin: false,
      targetStaysAdmin: false,
    });

    expect(result).toBe(false);
  });
});
