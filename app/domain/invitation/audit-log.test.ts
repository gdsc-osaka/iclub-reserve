import { describe, expect, it } from "vitest";

import { MembershipRole } from "../membership";
import {
  toInvitationAcceptChanges,
  toInvitationCancelChanges,
  toInvitationRejectChanges,
  toInvitationSendChanges,
} from "./audit-log";

describe("invitation audit-log", () => {
  it("toInvitationSendChanges で招待作成の記録が正しく組み立てられる", () => {
    const changes = toInvitationSendChanges({
      email: "newuser@example.com",
      role: MembershipRole.Member,
    });
    expect(changes).toEqual({
      email: { before: null, after: "newuser@example.com" },
      role: { before: null, after: "member" },
    });
  });

  it("toInvitationCancelChanges で招待取り消しの記録が正しく組み立てられる", () => {
    const changes = toInvitationCancelChanges("newuser@example.com", MembershipRole.Member);
    expect(changes).toEqual({
      email: { before: "newuser@example.com", after: "newuser@example.com" },
      role: { before: "member", after: "member" },
      status: { before: "pending", after: "canceled" },
    });
  });

  it("toInvitationAcceptChanges で招待承諾の記録が正しく組み立てられる", () => {
    const changes = toInvitationAcceptChanges("newuser@example.com", MembershipRole.Admin);
    expect(changes).toEqual({
      email: { before: "newuser@example.com", after: "newuser@example.com" },
      role: { before: "admin", after: "admin" },
      status: { before: "pending", after: "accepted" },
    });
  });

  it("toInvitationRejectChanges で招待辞退の記録が正しく組み立てられる", () => {
    const changes = toInvitationRejectChanges("newuser@example.com", MembershipRole.Member);
    expect(changes).toEqual({
      email: { before: "newuser@example.com", after: "newuser@example.com" },
      role: { before: "member", after: "member" },
      status: { before: "pending", after: "rejected" },
    });
  });
});
