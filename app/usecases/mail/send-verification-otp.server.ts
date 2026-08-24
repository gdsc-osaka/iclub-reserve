import {
  createSendEmailUseCase,
  type SendEmailDeps,
  type SendEmailError,
} from "./send-email.server";
import type { ResultAsync } from "neverthrow";

/**
 * OTP（ワンタイムパスワード）の有効期限（秒）。
 * Better Auth の emailOTP プラグインの `expiresIn` にも同じ値を渡すこと。
 * 片方だけ変えるとメール本文の案内と実際の期限がずれる。
 */
export const OTP_EXPIRES_IN_SECONDS = 300;

/** Better Auth の emailOTP プラグインが渡してくる OTP の用途 */
export type VerificationOtpType =
  | "sign-in"
  | "email-verification"
  | "forget-password"
  | "change-email";

export type SendVerificationOtpInput = {
  readonly email: string;
  readonly otp: string;
  readonly type: VerificationOtpType;
};

export type SendVerificationOtpUseCase = (
  input: SendVerificationOtpInput,
) => ResultAsync<void, SendEmailError>;

/** 用途ごとの件名と、本文の書き出しに使う文言 */
const TEMPLATES: Record<VerificationOtpType, { subject: string; purpose: string }> = {
  "sign-in": {
    subject: "【i-Club予約システム】ログイン用の認証コード",
    purpose: "ログイン",
  },
  "email-verification": {
    subject: "【i-Club予約システム】メールアドレス確認用の認証コード",
    purpose: "メールアドレスの確認",
  },
  "forget-password": {
    subject: "【i-Club予約システム】パスワード再設定用の認証コード",
    purpose: "パスワードの再設定",
  },
  "change-email": {
    subject: "【i-Club予約システム】メールアドレス変更用の認証コード",
    purpose: "メールアドレスの変更",
  },
};

const buildBody = (purpose: string, otp: string): string =>
  [
    "i-Club 予約システムをご利用いただきありがとうございます。",
    "",
    `${purpose}用の認証コードは次のとおりです。`,
    "",
    `    ${otp}`,
    "",
    `このコードの有効期限は ${OTP_EXPIRES_IN_SECONDS / 60} 分です。`,
    "心当たりのない場合は、このメールを破棄してください。",
    "",
    "----------------------------------------",
    "大阪大学 Innovators' Club (i-Club) 予約システム",
    "※このメールは送信専用です。返信はできません。",
  ].join("\n");

/**
 * 認証コード（OTP）をメールで送信するユースケース。
 *
 * 用途ごとの文面をここに集約し、送信そのものは SendEmailUseCase に委譲する。
 * 文面を変えたい場合は TEMPLATES と buildBody だけを編集すればよい。
 */
export const createSendVerificationOtpUseCase = (
  deps: SendEmailDeps,
): SendVerificationOtpUseCase => {
  const sendEmail = createSendEmailUseCase(deps);

  return ({ email, otp, type }) => {
    const template = TEMPLATES[type];

    return sendEmail({
      to: email,
      subject: template.subject,
      text: buildBody(template.purpose, otp),
    });
  };
};
