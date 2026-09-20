import { describe, expect, it } from "vitest";
import { isRetryable, MailSendErrorCode } from "./mail-sender";
import { classifySmtpError } from "./smtp-error";

describe("classifySmtpError", () => {
  it("254: 抑制リストへの登録は Rejected（恒久拒否）に分類される", () => {
    const error = classifySmtpError(
      "Failed to send RCPT TO: 254 4.7.1 Suppression for user test@example.com",
    );
    expect(error.code).toBe(MailSendErrorCode.Rejected);
    expect(isRetryable(error)).toBe(false);
  });

  it("421: 接続過多は RateLimited（再試行対象）に分類される", () => {
    const error = classifySmtpError(
      "Failed to send HELO: 421 4.7.0 Too many connections from your IP",
    );
    expect(error.code).toBe(MailSendErrorCode.RateLimited);
    expect(isRetryable(error)).toBe(true);
  });

  it("455: レート超過は RateLimited（再試行対象）に分類される", () => {
    const error = classifySmtpError(
      "Failed to send DATA: 455 Maximum messages sent per minute reached",
    );
    expect(error.code).toBe(MailSendErrorCode.RateLimited);
    expect(isRetryable(error)).toBe(true);
  });

  it("その他の 4xx は RateLimited（再試行対象）に分類される", () => {
    const error = classifySmtpError(
      "Failed to send RCPT TO: 450 4.2.1 Mailbox temporarily unavailable",
    );
    expect(error.code).toBe(MailSendErrorCode.RateLimited);
    expect(isRetryable(error)).toBe(true);
  });

  it("535: 認証エラーは AuthFailed（恒久失敗）に分類される", () => {
    const error = classifySmtpError(
      "Failed to authenticate: 535 5.7.8 Authentication credentials invalid",
    );
    expect(error.code).toBe(MailSendErrorCode.AuthFailed);
    expect(isRetryable(error)).toBe(false);
  });

  it("その他の 5xx は Rejected（恒久拒否）に分類される", () => {
    const error = classifySmtpError("Failed to send RCPT TO: 550 5.1.1 User unknown");
    expect(error.code).toBe(MailSendErrorCode.Rejected);
    expect(isRetryable(error)).toBe(false);
  });

  it("ホスト名やポート番号（:465）が含まれる接続タイムアウトは ConnectionFailed に分類される", () => {
    const error = classifySmtpError(
      "Failed to connect to smtp.email.ap-osaka-1.oci.oraclecloud.com:465: Connection timeout",
    );
    expect(error.code).toBe(MailSendErrorCode.ConnectionFailed);
    expect(isRetryable(error)).toBe(true);
  });

  it("応答コードのないソケットエラーは ConnectionFailed に分類される", () => {
    const error = classifySmtpError("Socket closed unexpectedly");
    expect(error.code).toBe(MailSendErrorCode.ConnectionFailed);
    expect(isRetryable(error)).toBe(true);
  });

  it("応答コードのない認証文言エラーは AuthFailed に分類される", () => {
    const error = classifySmtpError("Authentication failed unexpectedly");
    expect(error.code).toBe(MailSendErrorCode.AuthFailed);
    expect(isRetryable(error)).toBe(false);
  });

  it("未知のエラーは SendFailed に分類される", () => {
    const error = classifySmtpError("Unexpected internal error occurred");
    expect(error.code).toBe(MailSendErrorCode.SendFailed);
    expect(isRetryable(error)).toBe(false);
  });
});
