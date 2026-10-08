import { describe, expect, it } from "vitest";

import { MembershipRole } from "./index";
import { toMembershipRemoveChanges, toMembershipRoleChanges } from "./audit-log";

describe("membership audit-log", () => {
  it("toMembershipRoleChanges でロール変更の記録が正しく組み立てられる（user_id は固定、role は変更前後）", () => {
    const changes = toMembershipRoleChanges(
      "usr_student_01",
      MembershipRole.Member,
      MembershipRole.Admin,
    );
    expect(changes).toEqual({
      user_id: { before: "usr_student_01", after: "usr_student_01" },
      role: { before: "member", after: "admin" },
    });
  });

  it("toMembershipRemoveChanges でメンバー削除の記録が正しく組み立てられる（user_id は固定、role は前→null）", () => {
    const changes = toMembershipRemoveChanges("usr_student_01", MembershipRole.Member);
    expect(changes).toEqual({
      user_id: { before: "usr_student_01", after: "usr_student_01" },
      role: { before: "member", after: null },
    });
  });
});
