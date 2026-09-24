import { afterEach, describe, expect, it, vi } from "vitest";

import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { MailOutboxNotifier } from "~/domain/mail/mail-outbox-notifier";
import {
  createFinishEmailChangeUseCase,
  FinishEmailChangeLogCode,
  type FinishEmailChangeDeps,
  type FinishEmailChangeInput,
} from "./finish-email-change";

const input: FinishEmailChangeInput = {
  userId: "usr_user_1",
  userName: "阪大 太郎",
  previousEmail: "old@osaka-u.ac.jp",
  newEmail: "new@osaka-u.ac.jp",
  currentToken: "current_session_token",
  changedAt: new Date("2026-09-24T12:00:00Z"),
};

/**
 * 呼ばれた順を記録する依存を作る。
 *
 * 既定では、通知もログアウトも成功する。失敗させたいものだけ `overrides` で差し替える。
 */
const createDeps = (overrides: Partial<FinishEmailChangeDeps> = {}) => {
  const calls: string[] = [];
  const enqueued: MailDraft[] = [];

  const deps: FinishEmailChangeDeps = {
    enqueueMails: vi.fn(async (mails: readonly MailDraft[]) => {
      calls.push("enqueueMails");
      enqueued.push(...mails);
      return ["outbox_1"];
    }),
    mailOutboxNotifier: {
      notifyEnqueued: vi.fn(() => {
        calls.push("notifyEnqueued");
      }),
    } satisfies MailOutboxNotifier,
    sessionStore: {
      listSessions: vi.fn(async () => {
        calls.push("listSessions");
        return [
          { token: "current_session_token" },
          { token: "other_session_1" },
          { token: "other_session_2" },
        ];
      }),
      deleteSessions: vi.fn(async () => {
        calls.push("deleteSessions");
      }),
    },
    staffContactEmail: "support@example.com",
    ...overrides,
  };

  return { deps, calls, enqueued };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createFinishEmailChangeUseCase", () => {
  it("通知を積んで配送を頼んでから、変更に使った端末以外をログアウトさせる", async () => {
    const { deps, calls, enqueued } = createDeps();

    await createFinishEmailChangeUseCase(deps)(input);

    // 順序は BUC-024 の業務フローのとおり（通知 → ログアウト）
    expect(calls).toEqual(["enqueueMails", "notifyEnqueued", "listSessions", "deleteSessions"]);
    expect(deps.mailOutboxNotifier.notifyEnqueued).toHaveBeenCalledWith(["outbox_1"]);
    // 通知は変更前のアドレスへ送る
    expect(enqueued.map((mail) => mail.to.address)).toEqual(["old@osaka-u.ac.jp"]);
    // 変更に使った端末のトークンは消さない
    expect(deps.sessionStore.deleteSessions).toHaveBeenCalledWith([
      "other_session_1",
      "other_session_2",
    ]);
  });

  it("ほかの端末が無ければ、削除を呼ばない", async () => {
    const { deps } = createDeps({
      sessionStore: {
        listSessions: vi.fn(async () => [{ token: "current_session_token" }]),
        deleteSessions: vi.fn(async () => {}),
      },
    });

    await createFinishEmailChangeUseCase(deps)(input);

    expect(deps.sessionStore.deleteSessions).not.toHaveBeenCalled();
  });

  it("通知を積めなくてもログアウトは行い、変更前のアドレスを添えたエラーのログを 1 件残す", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = createDeps({
      enqueueMails: vi.fn(async () => {
        throw new Error("D1 connection lost");
      }),
    });

    await createFinishEmailChangeUseCase(deps)(input);

    expect(deps.sessionStore.deleteSessions).toHaveBeenCalledWith([
      "other_session_1",
      "other_session_2",
    ]);
    expect(deps.mailOutboxNotifier.notifyEnqueued).not.toHaveBeenCalled();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        code: FinishEmailChangeLogCode.NoticeNotEnqueued,
        userId: "usr_user_1",
        // 事務局が手で連絡するための手がかり（EVT-016）
        details: { previousEmail: "old@osaka-u.ac.jp" },
      }),
    );
    // 変更後のアドレスは入力された値なので残さない（ADR-004 決定 9）
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("new@osaka-u.ac.jp");
  });

  it("ログアウトに失敗しても例外を投げず、エラーのログを残す", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = createDeps({
      sessionStore: {
        listSessions: vi.fn(async () => {
          throw new Error("Internal adapter failure");
        }),
        deleteSessions: vi.fn(async () => {}),
      },
    });

    await expect(createFinishEmailChangeUseCase(deps)(input)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "error",
        code: FinishEmailChangeLogCode.SessionsNotRevoked,
        userId: "usr_user_1",
      }),
    );
  });
});
