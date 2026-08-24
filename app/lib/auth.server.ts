// Better Auth の型は内部で zod の型を参照する。pnpm の構成では tsc が
// その型を名前で解決できず TS2742 になるため、型だけをここで参照しておく。
import type {} from "zod/v4/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { emailOTP } from "better-auth/plugins";
import { env } from "cloudflare:workers";
import { createDb } from "./db";

const createAuth = () =>
  betterAuth({
    database: drizzleAdapter(createDb(env.DB), {
      provider: "sqlite",
    }),
    plugins: [
      emailOTP({
        changeEmail: {
          enabled: true,
          verifyCurrentEmail: true,
        },

        // 認証コードの実際の送信処理は後続の PR で実装する。
        async sendVerificationOTP({ email: _email, otp: _otp, type }) {
          if (type === "sign-in") {
            // サインイン用の認証コードを送る
          } else if (type === "email-verification") {
            // メールアドレス確認用の認証コードを送る
          } else {
            // パスワード再設定用の認証コードを送る
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
