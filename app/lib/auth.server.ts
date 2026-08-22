// Better Auth の型は内部で zod の型を参照する。pnpm の構成では tsc が
// その型を名前で解決できず TS2742 になるため、型だけをここで参照しておく。
import type {} from "zod/v4/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { env } from "cloudflare:workers";
import { createDb } from "./db";
import { createMailSender, getMailFrom } from "~/infra/mail/mail-sender-factory.server";
import {
  createSendVerificationOtpUseCase,
  OTP_EXPIRES_IN_SECONDS,
} from "~/usecases/mail/send-verification-otp.server";

const createAuth = () =>
  betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(createDb(env.DB), {
      provider: "sqlite",
    }),
    plugins: [
      emailOTP({
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        changeEmail: {
          enabled: true,
          verifyCurrentEmail: true,
        },

        /**
         * 認証コードのメール送信。
         *
         * Better Auth はこのコールバックをバックグラウンドで実行するため、
         * ここで例外を投げても HTTP レスポンスは 200 のまま。
         * 送信の失敗は Workers のログ（ローカルではターミナル）に出る。
         */
        async sendVerificationOTP({ email, otp, type }) {
          const sendVerificationOtp = createSendVerificationOtpUseCase({
            mailSender: createMailSender(),
            from: getMailFrom(),
          });

          const result = await sendVerificationOtp({ email, otp, type });

          if (result.isErr()) {
            // Better Auth 側にエラーを伝えるため、ここでは例外に変換する
            throw new Error(`認証コードのメール送信に失敗しました: ${result.error.type}`);
          }
        },
      }),
    ],
  });

let authInstance: ReturnType<typeof createAuth> | undefined;

/**
 * Better Auth のインスタンスを取得する。
 *
 * Cloudflare Workers では D1 などのバインディングをモジュール読み込み時点で
 * 参照できないため、初回の呼び出し時に生成して以降は同じ isolate 内で使い回す。
 */
export const getAuth = (): ReturnType<typeof createAuth> => {
  authInstance ??= createAuth();
  return authInstance;
};
