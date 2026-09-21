import { describe, expect, it } from "vitest";
import { INVITATION_EXPIRES_IN_HOURS, invitationAcceptPath, invitationExpiresAt } from "./index";

describe("invitationExpiresAt", () => {
  it("渡した now のちょうど 48 時間後を返す", () => {
    const now = new Date("2026-09-21T12:00:00.000Z");
    const expiresAt = invitationExpiresAt(now);

    const expectedTime = now.getTime() + INVITATION_EXPIRES_IN_HOURS * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBe(expectedTime);
    expect(expiresAt.toISOString()).toBe("2026-09-23T12:00:00.000Z");
  });

  it("渡された Date を書き換えず、新しい Date を返す", () => {
    const originalTime = new Date("2026-09-21T12:00:00.000Z").getTime();
    const now = new Date(originalTime);

    const expiresAt = invitationExpiresAt(now);

    // 引数の Date オブジェクトが変更されていないこと
    expect(now.getTime()).toBe(originalTime);
    // 戻り値が別インスタンスであること
    expect(expiresAt).not.toBe(now);
  });
});

describe("invitationAcceptPath", () => {
  it("/invitations/<id> を返す", () => {
    const id = "inv_123456";
    expect(invitationAcceptPath(id)).toBe("/invitations/inv_123456");
  });
});
