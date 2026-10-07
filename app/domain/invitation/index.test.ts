import { describe, expect, it } from "vitest";
import {
  INVITATION_EXPIRES_IN_HOURS,
  InvitationStatus,
  InvitationUnavailableReason,
  invitationAcceptPath,
  invitationExpiresAt,
  invitationUnavailableReason,
} from "./index";

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

describe("invitationUnavailableReason", () => {
  const now = new Date("2026-04-01T12:00:00.000Z");
  const validExpiresAt = new Date("2026-04-03T12:00:00.000Z");
  const actorEmail = "test@ecs.osaka-u.ac.jp";

  it("承諾待ち・期限内・宛先一致のときは null を返す", () => {
    const result = invitationUnavailableReason(
      {
        status: InvitationStatus.Pending,
        expiresAt: validExpiresAt,
        email: actorEmail,
      },
      actorEmail,
      now,
    );
    expect(result).toBeNull();
  });

  it("承諾待ち以外の状態のときは NotPending を返す", () => {
    const statuses = [
      InvitationStatus.Accepted,
      InvitationStatus.Rejected,
      InvitationStatus.Canceled,
    ] as const;

    for (const status of statuses) {
      const result = invitationUnavailableReason(
        {
          status,
          expiresAt: validExpiresAt,
          email: actorEmail,
        },
        actorEmail,
        now,
      );
      expect(result).toBe(InvitationUnavailableReason.NotPending);
    }
  });

  it("期限切れ（過去日時）のときは Expired を返す", () => {
    const pastExpiresAt = new Date("2026-04-01T11:59:59.000Z");
    const result = invitationUnavailableReason(
      {
        status: InvitationStatus.Pending,
        expiresAt: pastExpiresAt,
        email: actorEmail,
      },
      actorEmail,
      now,
    );
    expect(result).toBe(InvitationUnavailableReason.Expired);
  });

  it("期限ちょうど（expiresAt === now）は切れている扱い（Expired）になる", () => {
    const result = invitationUnavailableReason(
      {
        status: InvitationStatus.Pending,
        expiresAt: new Date(now.getTime()),
        email: actorEmail,
      },
      actorEmail,
      now,
    );
    expect(result).toBe(InvitationUnavailableReason.Expired);
  });

  it("宛先が一致しないときは NotAddressee を返す", () => {
    const result = invitationUnavailableReason(
      {
        status: InvitationStatus.Pending,
        expiresAt: validExpiresAt,
        email: "other@ecs.osaka-u.ac.jp",
      },
      actorEmail,
      now,
    );
    expect(result).toBe(InvitationUnavailableReason.NotAddressee);
  });

  it("状態が pending でなく期限切れでも、状態の判定が先（NotPending）になる", () => {
    const pastExpiresAt = new Date("2026-04-01T11:00:00.000Z");
    const result = invitationUnavailableReason(
      {
        status: InvitationStatus.Accepted,
        expiresAt: pastExpiresAt,
        email: actorEmail,
      },
      actorEmail,
      now,
    );
    expect(result).toBe(InvitationUnavailableReason.NotPending);
  });

  it("期限切れで宛先違いの場合、期限の判定が宛先より先（Expired）になる", () => {
    const pastExpiresAt = new Date("2026-04-01T11:00:00.000Z");
    const result = invitationUnavailableReason(
      {
        status: InvitationStatus.Pending,
        expiresAt: pastExpiresAt,
        email: "other@ecs.osaka-u.ac.jp",
      },
      actorEmail,
      now,
    );
    expect(result).toBe(InvitationUnavailableReason.Expired);
  });
});
