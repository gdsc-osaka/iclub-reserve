import { describe, expect, it } from "vitest";
import {
  createSendVerificationOtpUseCase,
  OTP_EXPIRES_IN_SECONDS,
  type VerificationOtpType,
} from "./send-verification-otp.server";
import { createFakeMailSender } from "~/infra/mail/fake-mail-sender";

const from = { address: "noreply@osaka-u.ac.jp", name: "i-Club 予約システム" };

describe("createSendVerificationOtpUseCase", () => {
  it("宛先・差出人・OTP を含むメールを 1 通送る", async () => {
    const mailSender = createFakeMailSender();
    const sendVerificationOtp = createSendVerificationOtpUseCase({ mailSender, from });

    const result = await sendVerificationOtp({
      email: "taro@osaka-u.ac.jp",
      otp: "123456",
      type: "sign-in",
    });

    expect(result.isOk()).toBe(true);
    expect(mailSender.sent).toHaveLength(1);

    const message = mailSender.sent[0];
    expect(message.to.address.value).toBe("taro@osaka-u.ac.jp");
    expect(message.from.address.value).toBe("noreply@osaka-u.ac.jp");
    expect(message.text).toContain("123456");
  });

  it("本文に有効期限（分）を記載する", async () => {
    const mailSender = createFakeMailSender();
    const sendVerificationOtp = createSendVerificationOtpUseCase({ mailSender, from });

    await sendVerificationOtp({ email: "taro@osaka-u.ac.jp", otp: "123456", type: "sign-in" });

    expect(mailSender.sent[0].text).toContain(`${OTP_EXPIRES_IN_SECONDS / 60} 分`);
  });

  it.each<[VerificationOtpType, string]>([
    ["sign-in", "ログイン"],
    ["email-verification", "メールアドレスの確認"],
    ["forget-password", "パスワードの再設定"],
    ["change-email", "メールアドレスの変更"],
  ])("type が %s のとき用途に応じた文面になる", async (type, purpose) => {
    const mailSender = createFakeMailSender();
    const sendVerificationOtp = createSendVerificationOtpUseCase({ mailSender, from });

    await sendVerificationOtp({ email: "taro@osaka-u.ac.jp", otp: "123456", type });

    const message = mailSender.sent[0];
    expect(message.subject).toContain("認証コード");
    expect(message.text).toContain(purpose);
  });

  it("宛先の形式が不正なら送信せずに失敗を返す", async () => {
    const mailSender = createFakeMailSender();
    const sendVerificationOtp = createSendVerificationOtpUseCase({ mailSender, from });

    const result = await sendVerificationOtp({
      email: "not-an-email",
      otp: "123456",
      type: "sign-in",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.type).toBe("invalid_email_address");
    expect(mailSender.sent).toHaveLength(0);
  });

  it("送信に失敗した場合はその失敗をそのまま返す", async () => {
    const mailSender = createFakeMailSender({ type: "auth_failed", cause: new Error("535") });
    const sendVerificationOtp = createSendVerificationOtpUseCase({ mailSender, from });

    const result = await sendVerificationOtp({
      email: "taro@osaka-u.ac.jp",
      otp: "123456",
      type: "sign-in",
    });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.type).toBe("auth_failed");
  });
});
