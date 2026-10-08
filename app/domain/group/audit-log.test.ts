import { describe, expect, it } from "vitest";

import { AuditLogAction } from "../audit-log";
import { GroupStatus } from "./index";
import {
  groupStatusAuditLogAction,
  toGroupCreatedChanges,
  toGroupNameUpdatedChanges,
  toGroupStatusChanges,
} from "./audit-log";

describe("group audit-log", () => {
  it("groupStatusAuditLogAction が有効化・無効化に対応する", () => {
    expect(groupStatusAuditLogAction[GroupStatus.Enabled]).toBe(AuditLogAction.GroupEnable);
    expect(groupStatusAuditLogAction[GroupStatus.Disabled]).toBe(AuditLogAction.GroupDisable);
  });

  it("toGroupCreatedChanges で作成の記録が正しく組み立てられる", () => {
    const changes = toGroupCreatedChanges({
      name: "ロボティクス部",
      status: GroupStatus.Pending,
    });
    expect(changes).toEqual({
      name: { before: null, after: "ロボティクス部" },
      status: { before: null, after: "pending" },
    });
  });

  it("toGroupNameUpdatedChanges で団体名の変更が正しく組み立てられる", () => {
    const changes = toGroupNameUpdatedChanges("旧ロボティクス部", "新ロボティクス部");
    expect(changes).toEqual({
      name: { before: "旧ロボティクス部", after: "新ロボティクス部" },
    });
  });

  it("toGroupStatusChanges でステータス変更が正しく組み立てられる", () => {
    const changes = toGroupStatusChanges(GroupStatus.Pending, GroupStatus.Enabled);
    expect(changes).toEqual({
      status: { before: "pending", after: "enabled" },
    });
  });
});
