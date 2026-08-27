// Better Auth の型は内部で zod の型を参照する。pnpm の構成では tsc が
// その型を名前で解決できず TS2742 になるため、型だけをここで参照しておく。
import type {} from "zod/v4/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { env } from "cloudflare:workers";
import { createDb } from "~/infra/db";
import {
  ALLOWED_EMAIL_DOMAINS_LABEL,
  EMAIL_DOMAIN_NOT_ALLOWED_CODE,
  isAllowedEmailAddress,
} from "~/domain/auth/allowed-email-domain";
import { createMailSender, getMailFrom } from "~/infra/mail/mail-sender-factory.server";
import {
  createSendVerificationOtpUseCase,
  OTP_EXPIRES_IN_SECONDS,
} from "~/usecases/mail/send-verification-otp.server";

/** 許可外のドメインを拒否するときに返す説明文。 */
const NOT_ALLOWED_MESSAGE = `${ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスでのみご利用いただけます。`;

/**
 * Better Auth の設定値（`.dev.vars` や `wrangler secret put` で渡す）。
 *
 * `wrangler types` が生成する `Env` には「今の環境に実際にある値」しか載らない。
 * シークレットは CI には存在しないため型にも現れず、直接参照すると型検査が落ちる。
 * そのため、ここで形だけを宣言して読む。
 */
type AuthSecrets = {
  readonly BETTER_AUTH_SECRET?: string;
  readonly BETTER_AUTH_URL?: string;
};

const createAuth = () =>
  betterAuth({
    secret: (env as Env & AuthSecrets).BETTER_AUTH_SECRET,
    baseURL: (env as Env & AuthSecrets).BETTER_AUTH_URL,
    database: drizzleAdapter(createDb(env.DB), {
      provider: "sqlite",
    }),

    user: {
      /**
       * アカウントを作れるメールアドレスを大阪大学のドメインに限定する。
       *
       * Better Auth がユーザーを作る直前に呼ばれ、`{ error }` を返すと 403 で拒否される。
       * 下の `hooks.before` は認証コードの送信を入口で止めるためのもので、
       * こちらは「どの経路から来てもアカウントは作らせない」という最後の砦。
       */
      validateUserInfo: ({ user }) => {
        if (isAllowedEmailAddress(user.email ?? "")) return;

        return {
          error: EMAIL_DOMAIN_NOT_ALLOWED_CODE,
          errorDescription: NOT_ALLOWED_MESSAGE,
        };
      },
    },

    hooks: {
      /**
       * 新規登録につながらない宛先には、そもそも認証コードを送らない。
       *
       * ユーザー作成時のチェックだけだと、部外者にもメールが届いたうえで
       * 最後の最後に失敗することになる（迷惑メールの踏み台にもなりうる）。
       * そのため送信リクエストの時点で 403 を返す。
       *
       * ただし制限したいのは「誰が登録できるか」であって、
       * 既に登録済みの人を締め出すことではない。
       * そのため、アカウントが既にある場合はドメインを問わず通す。
       */
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/email-otp/send-verification-otp") return;

        const email = (ctx.body as { email?: unknown } | undefined)?.email;
        if (typeof email !== "string" || isAllowedEmailAddress(email)) return;

        const existing = await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase());
        if (existing) return;

        throw new APIError("FORBIDDEN", {
          code: EMAIL_DOMAIN_NOT_ALLOWED_CODE,
          message: NOT_ALLOWED_MESSAGE,
        });
      }),
    },

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
