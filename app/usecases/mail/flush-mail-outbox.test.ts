import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import {
  MailOutboxErrorCode,
  type MailOutbox,
  type MailOutboxEntry,
} from "~/domain/mail/mail-outbox";
import { MailSendErrorCode, type MailSender } from "~/domain/mail/mail-sender";
import {
  FLUSH_BATCH_SIZE,
  flushMailOutboxUseCase,
  MAX_ATTEMPTS,
  nextAttemptDelayMs,
} from "./flush-mail-outbox.server";

describe("flush-mail-outbox", () => {
  describe("定数とバックオフ", () => {
    it("FLUSH_BATCH_SIZE は 20、MAX_ATTEMPTS は 5", () => {
      expect(FLUSH_BATCH_SIZE).toBe(20);
      expect(MAX_ATTEMPTS).toBe(5);
    });

    it("1回目〜5回目のバックオフ待機時間が仕様どおり（30秒→1分→2分→4分→8分）に延びる", () => {
      expect(nextAttemptDelayMs(1)).toBe(30_000); // 30秒
      expect(nextAttemptDelayMs(2)).toBe(60_000); // 1分
      expect(nextAttemptDelayMs(3)).toBe(120_000); // 2分
      expect(nextAttemptDelayMs(4)).toBe(240_000); // 4分
      expect(nextAttemptDelayMs(5)).toBe(480_000); // 8分
    });

    it("待機時間の上限が1時間（3,600,000ミリ秒）で頭打ちになる", () => {
      expect(nextAttemptDelayMs(7)).toBe(1_920_000); // 32分
      expect(nextAttemptDelayMs(8)).toBe(3_600_000); // 64分 → 1時間
      expect(nextAttemptDelayMs(10)).toBe(3_600_000); // 1時間上限
    });
  });

  describe("flushMailOutboxUseCase", () => {
    const baseEntry: MailOutboxEntry = {
      id: "outbox_01",
      idempotencyKey: "reservation:approved:res_1:usr_1",
      to: { address: "user@example.com", name: "利用者" },
      subject: "予約承認通知",
      text: "予約が承認されました",
      attemptCount: 1,
    };

    const from = { address: "noreply@gdgoc-osaka.jp", name: "i-Club 予約システム" };

    it("送信成功時は markSent が呼ばれ、Message-ID ヘッダが付与される", async () => {
      const claimDue = vi.fn(() => okAsync([baseEntry]));
      const markSent = vi.fn((_id: string) => okAsync(undefined));
      const markRetryable = vi.fn();
      const markDead = vi.fn();
      const send = vi.fn((_msg: unknown) => okAsync(undefined));

      const mailOutbox: MailOutbox = { claimDue, markSent, markRetryable, markDead };
      const mailSender: MailSender = { send };

      const result = await flushMailOutboxUseCase({ mailOutbox, mailSender, from });

      expect(result).toEqual({ claimed: 1, sent: 1, retried: 0, dead: 0, stateUpdateFailed: 0 });
      expect(markSent).toHaveBeenCalledWith("outbox_01");
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { "Message-ID": "<outbox_01@gdgoc-osaka.jp>" },
        }),
      );
    });

    it("一過性のエラーかつ attemptCount < 5 の場合は markRetryable でバックオフ時刻が設定される", async () => {
      const testNow = new Date("2026-09-20T12:00:00Z");
      const entry: MailOutboxEntry = { ...baseEntry, attemptCount: 1 };

      const claimDue = vi.fn(() => okAsync([entry]));
      const markSent = vi.fn();
      const markRetryable = vi.fn(() => okAsync(undefined));
      const markDead = vi.fn();
      const send = vi.fn((_msg: unknown) =>
        errAsync({
          code: MailSendErrorCode.RateLimited,
          message: "SMTP サーバーが一時的に受け付けられない状態です。",
          cause: "455 rate limit",
        }),
      );

      const mailOutbox: MailOutbox = { claimDue, markSent, markRetryable, markDead };
      const mailSender: MailSender = { send };

      const result = await flushMailOutboxUseCase(
        { mailOutbox, mailSender, from },
        { now: testNow },
      );

      expect(result).toEqual({ claimed: 1, sent: 0, retried: 1, dead: 0, stateUpdateFailed: 0 });
      expect(markRetryable).toHaveBeenCalledWith({
        id: "outbox_01",
        nextAttemptAt: new Date("2026-09-20T12:00:30Z"), // 30秒後
        error: expect.objectContaining({ code: MailSendErrorCode.RateLimited }),
      });
    });

    it("一過性のエラーでも attemptCount >= 5 (MAX_ATTEMPTS) の場合は markDead になる", async () => {
      const entry: MailOutboxEntry = { ...baseEntry, attemptCount: 5 };

      const claimDue = vi.fn(() => okAsync([entry]));
      const markSent = vi.fn();
      const markRetryable = vi.fn();
      const markDead = vi.fn(() => okAsync(undefined));
      const send = vi.fn((_msg: unknown) =>
        errAsync({
          code: MailSendErrorCode.RateLimited,
          message: "SMTP サーバーが一時的に受け付けられない状態です。",
          cause: "455 rate limit",
        }),
      );

      const mailOutbox: MailOutbox = { claimDue, markSent, markRetryable, markDead };
      const mailSender: MailSender = { send };

      const result = await flushMailOutboxUseCase({ mailOutbox, mailSender, from });

      expect(result).toEqual({ claimed: 1, sent: 0, retried: 0, dead: 1, stateUpdateFailed: 0 });
      expect(markDead).toHaveBeenCalledWith({
        id: "outbox_01",
        error: expect.objectContaining({ code: MailSendErrorCode.RateLimited }),
      });
      expect(markRetryable).not.toHaveBeenCalled();
    });

    it("恒久的なエラー（rejected / auth_failed）は 1 回目でも markDead になる", async () => {
      const entry: MailOutboxEntry = { ...baseEntry, attemptCount: 1 };

      const claimDue = vi.fn(() => okAsync([entry]));
      const markSent = vi.fn();
      const markRetryable = vi.fn();
      const markDead = vi.fn(() => okAsync(undefined));
      const send = vi.fn((_msg: unknown) =>
        errAsync({
          code: MailSendErrorCode.Rejected,
          message: "宛先が抑制リストに登録されているため送信できません。",
          cause: "254 suppression",
        }),
      );

      const mailOutbox: MailOutbox = { claimDue, markSent, markRetryable, markDead };
      const mailSender: MailSender = { send };

      const result = await flushMailOutboxUseCase({ mailOutbox, mailSender, from });

      expect(result).toEqual({ claimed: 1, sent: 0, retried: 0, dead: 1, stateUpdateFailed: 0 });
      expect(markDead).toHaveBeenCalledWith({
        id: "outbox_01",
        error: expect.objectContaining({ code: MailSendErrorCode.Rejected }),
      });
    });

    it("メールアドレス不正（createMailMessage 失敗）の行は即座に markDead になる", async () => {
      const invalidEntry: MailOutboxEntry = {
        ...baseEntry,
        to: { address: "invalid-email-no-at", name: "無効" },
      };

      const claimDue = vi.fn(() => okAsync([invalidEntry]));
      const markSent = vi.fn();
      const markRetryable = vi.fn();
      const markDead = vi.fn(() => okAsync(undefined));
      const send = vi.fn();

      const mailOutbox: MailOutbox = { claimDue, markSent, markRetryable, markDead };
      const mailSender: MailSender = { send };

      const result = await flushMailOutboxUseCase({ mailOutbox, mailSender, from });

      expect(result).toEqual({ claimed: 1, sent: 0, retried: 0, dead: 1, stateUpdateFailed: 0 });
      expect(send).not.toHaveBeenCalled();
      expect(markDead).toHaveBeenCalledWith({
        id: "outbox_01",
        error: expect.objectContaining({ code: MailSendErrorCode.SendFailed }),
      });
    });

    it("1通の送信失敗で全体の処理が中断せず、残りのメールが送信される", async () => {
      const entry1: MailOutboxEntry = { ...baseEntry, id: "outbox_01" };
      const entry2: MailOutboxEntry = { ...baseEntry, id: "outbox_02" };

      const claimDue = vi.fn(() => okAsync([entry1, entry2]));
      const markSent = vi.fn(() => okAsync(undefined));
      const markRetryable = vi.fn(() => okAsync(undefined));
      const markDead = vi.fn();

      // 1 通目は失敗、2 通目は成功
      const send = vi
        .fn()
        .mockReturnValueOnce(
          errAsync({
            code: MailSendErrorCode.ConnectionFailed,
            message: "SMTP サーバーに接続できませんでした。",
            cause: "timeout",
          }),
        )
        .mockReturnValueOnce(okAsync(undefined));

      const mailOutbox: MailOutbox = { claimDue, markSent, markRetryable, markDead };
      const mailSender: MailSender = { send };

      const result = await flushMailOutboxUseCase({ mailOutbox, mailSender, from });

      expect(result).toEqual({ claimed: 2, sent: 1, retried: 1, dead: 0, stateUpdateFailed: 0 });
      expect(markRetryable).toHaveBeenCalledWith(expect.objectContaining({ id: "outbox_01" }));
      expect(markSent).toHaveBeenCalledWith("outbox_02");
    });

    it("送信できても markSent が失敗した行は sent ではなく stateUpdateFailed に数える", async () => {
      // 'sending' のまま残る行なので、送信済みとして数えてしまうと戻り値が実態と食い違う
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const claimDue = vi.fn(() => okAsync([baseEntry]));
      const markSent = vi.fn(() =>
        errAsync({
          code: MailOutboxErrorCode.DatabaseError,
          message: "outbox 操作に失敗しました。",
        }),
      );
      const markRetryable = vi.fn();
      const markDead = vi.fn();
      const send = vi.fn((_msg: unknown) => okAsync(undefined));

      const mailOutbox: MailOutbox = { claimDue, markSent, markRetryable, markDead };
      const mailSender: MailSender = { send };

      const result = await flushMailOutboxUseCase({ mailOutbox, mailSender, from });

      expect(result).toEqual({ claimed: 1, sent: 0, retried: 0, dead: 0, stateUpdateFailed: 1 });
      expect(send).toHaveBeenCalledTimes(1);

      consoleError.mockRestore();
    });
  });
});
