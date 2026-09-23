import { describe, expect, it } from "vitest";

import { FacilityErrorCode } from "~/domain/facility";
import { openFacilityCreateFormUseCase } from "./open-facility-create-form";

describe("openFacilityCreateFormUseCase", () => {
  it("事務局スタッフは登録画面を開ける", async () => {
    const result = await openFacilityCreateFormUseCase({
      actorUserId: "usr_staff_01",
      isStaff: true,
    });

    expect(result.isOk()).toBe(true);
  });

  it("事務局スタッフでなければ Forbidden になる", async () => {
    const result = await openFacilityCreateFormUseCase({
      actorUserId: "usr_normal_01",
      isStaff: false,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.code).toBe(FacilityErrorCode.Forbidden);
    expect(error.userMessage).toBe("施設の管理は事務局のみが行えます。");
  });
});
