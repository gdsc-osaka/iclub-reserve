import { describe, expect, it } from "vitest";
import { isRetryable } from "./mail-sender";
import { classifySmtpError } from "./smtp-error";

describe("classifySmtpError", () => {
  it("254: 抑制リストへの登録は rejected（恒久拒否）に分類される", () => {
    const error = classifySmtpError(
      "Failed to send RCPT TO: 254 4.7.1 Suppression for user test@example.com",
    );
    expect(error.type).toBe("rejected");
    expect(isRetryable(error)).toBe(false);
  });

  it("421: 接続過多は rate_limited（再試行対象）に分類される", () => {
    const error = classifySmtpError(
      "Failed to send HELO: 421 4.7.0 Too many connections from your IP",
    );
    expect(error.type).toBe("rate_limited");
    expect(isRetryable(error)).toBe(true);
  });

  it("455: レート超過は rate_limited（再試行対象）に分類される", () => {
    const error = classifySmtpError(
      "Failed to send DATA: 455 Maximum messages sent per minute reached",
    );
    expect(error.type).toBe("rate_limited");
    expect(isRetryable(error)).toBe(true);
  });

  it("その他の 4xx は rate_limited（再試行対象）に分類される", () => {
    const error = classifySmtpError(
      "Failed to send RCPT TO: 450 4.2.1 Mailbox temporarily unavailable",
    );
    expect(error.type).toBe("rate_limited");
    expect(isRetryable(error)).toBe(true);
  });

  it("535: 認証エラーは auth_failed（恒久失敗）に分類される", () => {
    const error = classifySmtpError(
      "Failed to authenticate: 535 5.7.8 Authentication credentials invalid",
    );
    expect(error.type).toBe("auth_failed");
    expect(isRetryable(error)).toBe(false);
  });

  it("その他の 5xx は rejected（恒久拒否）に分類される", () => {
    const error = classifySmtpError("Failed to send RCPT TO: 550 5.1.1 User unknown");
    expect(error.type).toBe("rejected");
    expect(isRetryable(error)).toBe(false);
  });

  it("ホスト名やポート番号（:465）が含まれる接続タイムアウトは connection_failed に分類される", () => {
    const error = classifySmtpError(
      "Failed to connect to smtp.email.ap-osaka-1.oci.oraclecloud.com:465: Connection timeout",
    );
    expect(error.type).toBe("connection_failed");
    expect(isRetryable(error)).toBe(true);
  });

  it("応答コードのないソケットエラーは connection_failed に分類される", () => {
    const error = classifySmtpError("Socket closed unexpectedly");
    expect(error.type).toBe("connection_failed");
    expect(isRetryable(error)).toBe(true);
  });

  it("応答コードのない認証文言エラーは auth_failed に分類される", () => {
    const error = classifySmtpError("Authentication failed unexpectedly");
    expect(error.type).toBe("auth_failed");
    expect(isRetryable(error)).toBe(false);
  });

  it("未知のエラーは send_failed に分類される", () => {
    const error = classifySmtpError("Unexpected internal error occurred");
    expect(error.type).toBe("send_failed");
    expect(isRetryable(error)).toBe(false);
  });
});
