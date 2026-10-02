import { describe, expect, it } from "vitest";

import { formatDateTime } from "~/lib/date";
import { createEmailChangedMailDraft } from "./email-changed-mail";

describe("createEmailChangedMailDraft (EVT-016)", () => {
  const input = {
    userId: "usr_test_123",
    userName: "阪大 太郎",
    previousEmail: "before@osaka-u.ac.jp",
    newEmail: "after@osaka-u.ac.jp",
    changedAt: new Date("2026-09-24T10:30:00.000Z"),
    staffContactEmail: "iclub-reserve-support@gdgoc-osaka.jp",
  };

  it("宛先は変更前のアドレスで、宛名にユーザー氏名が入る", () => {
    const draft = createEmailChangedMailDraft(input);

    expect(draft.to.address).toBe("before@osaka-u.ac.jp");
    expect(draft.to.name).toBe("阪大 太郎");
  });

  it("本文に変更後のアドレス・変更日時・窓口のアドレスが含まれる", () => {
    const draft = createEmailChangedMailDraft(input);

    expect(draft.text).toContain("after@osaka-u.ac.jp");
    expect(draft.text).toContain(formatDateTime(input.changedAt));
    expect(draft.text).toContain("iclub-reserve-support@gdgoc-osaka.jp");
    expect(draft.text).toContain("お心当たりがない場合");
  });

  it("idempotencyKey に userId と時刻（タイムスタンプ）が入る", () => {
    const draft = createEmailChangedMailDraft(input);

    const expectedKey = `user:email-changed:${input.userId}:${input.changedAt.getTime()}`;
    expect(draft.idempotencyKey).toBe(expectedKey);
  });
});
