// Better Auth の型は内部で zod の型を参照する。pnpm の構成では tsc が
// その型を名前で解決できず TS2742 になるため、型だけをここで参照しておく。
import type {} from "zod/v4/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { env, waitUntil } from "cloudflare:workers";
import { createDb } from "~/infra/db";
import {
  ALLOWED_EMAIL_DOMAINS_LABEL,
  EMAIL_DOMAIN_NOT_ALLOWED_CODE,
  isAllowedEmailAddress,
} from "~/domain/authn/allowed-email-domain";
import { toPasskeyName } from "~/domain/authn/device-name";
import { SESSION_FRESH_AGE_SECONDS } from "~/domain/authn/session-freshness";
import { ErrorKind } from "~/domain/error";
import { insertMailsAlone } from "~/infra/mail/mail-outbox-writes";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { recordPasskeyUse } from "~/infra/user/passkey-usage-repo";
import { logFailure } from "~/lib/log.server";
import { formatSendEmailError } from "~/usecases/mail/send-email.server";
import {
  createSendVerificationOtpUseCase,
  OTP_EXPIRES_IN_SECONDS,
} from "~/usecases/mail/send-verification-otp.server";
import { createFinishEmailChangeUseCase } from "~/usecases/user/finish-email-change";
import { passkey } from "@better-auth/passkey";
import {
  applyUpdatePasskeyRule,
  applyUpdateUserRule,
  applyVerifyRegistrationRule,
  checkRequestEmailChangeRule,
} from "./auth-hook-rules";
import { buildPreviewTrustedOrigins } from "./preview-trusted-origins";
import { createId } from "@paralleldrive/cuid2";

/** 許可外のドメインを拒否するときに返す説明文。 */
const NOT_ALLOWED_MESSAGE = `${ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスでのみご利用いただけます。`;

/**
 * このアプリの名前。
 *
 * パスキーを登録するとき、OS やブラウザが出す保存ダイアログにそのまま表示される
 * （「"○○" のパスキーを保存しますか？」）。
 * 指定しないと Better Auth の既定値 "Better Auth" が出てしまうので必ず設定すること。
 */
const APP_NAME = "i-Club 予約システム";

/**
 * パスキーの検証で期待する origin（`https://example.com` の形）を求める。
 *
 * 指定しないと Better Auth はリクエストの Origin ヘッダーをそのまま期待値に使う。
 * ブラウザが origin と rpID の対応を強制するので実害は出にくいが、
 * 検証の期待値をクライアント任せにする理由もないため、こちらで固定する。
 *
 * URL として読めないときは undefined を返し、Better Auth の既定に任せる。
 * Better Auth CLI は `cloudflare:workers` を差し替えて `env` をダミーの Proxy にするため、
 * スキーマ生成の最中は `BETTER_AUTH_URL` が文字列にならない。
 * ここで素直に `new URL()` を呼ぶと、CLI が設定を読めずに失敗する。
 */
const toOrigin = (baseURL: string | undefined): string | undefined =>
  typeof baseURL === "string" && URL.canParse(baseURL) ? new URL(baseURL).origin : undefined;

/**
 * パスキーの検証で期待する origin を、環境に応じて決める。
 *
 * プレビューだけは固定しない。派生ブランチの Preview は `<ブランチ名>.<代表 URL のホスト名>`
 * で公開され（ADR-006）、origin がブランチごとに違うため、1 つの値に決められない。
 * Better Auth の `origin` はワイルドカードを受け付けないので、未指定にして
 * リクエストの Origin ヘッダーを期待値に使わせる。
 *
 * その Origin は、先に trustedOrigins（代表 URL とそのサブドメイン）の検査を通ったものだけ。
 * さらにブラウザは rpID（代表 URL のホスト名）の配下の origin にしかパスキーを使わせないので、
 * 信頼できる範囲は代表 URL のサブドメインに限られる。
 */
const toPasskeyOrigin = (
  appEnv: Env["APP_ENV"],
  baseURL: string | undefined,
): string | undefined => (appEnv === "preview" ? undefined : toOrigin(baseURL));

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

const createAuth = () => {
  const { BETTER_AUTH_SECRET, BETTER_AUTH_URL } = env as Env & AuthSecrets;

  return betterAuth({
    appName: APP_NAME,
    secret: BETTER_AUTH_SECRET,
    baseURL: BETTER_AUTH_URL,

    /**
     * CSRF 対策として、ここに挙げた origin からのリクエストだけを受け付ける。
     * baseURL の origin は Better Auth が自動で足すので、それ以外を渡す。
     *
     * プレビューだけ、ブランチごとのプレビュー URL を信頼する必要がある。
     * 理由と作り方は buildPreviewTrustedOrigins のコメントを参照。
     */
    trustedOrigins: env.APP_ENV === "preview" ? buildPreviewTrustedOrigins(BETTER_AUTH_URL) : [],

    database: drizzleAdapter(createDb(env.DB), {
      provider: "sqlite",
    }),

    advanced: {
      database: {
        // ID を CUID2 で生成
        generateId: () => createId(),
      },
      backgroundTasks: {
        handler: (promise) => waitUntil(promise),
      },
    },

    session: {
      freshAge: SESSION_FRESH_AGE_SECONDS,
    },

    user: {
      /**
       * Better Auth が管理する `user` テーブルに、このアプリ独自の列を足す。
       *
       * ここに書いておかないと Better Auth CLI のスキーマ生成に含まれず、
       * 生成のたびに列が消えてしまう。
       * `input: false` でクライアントからの書き込みを禁じ、
       * `required: true` と `defaultValue` で `NOT NULL DEFAULT 0` になる。
       */
      additionalFields: {
        /** 事務局スタッフかどうか。 */
        is_staff: {
          type: "boolean",
          defaultValue: false,
          input: false,
          required: true,
        },
      },

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
      before: createAuthMiddleware(async (ctx) => {
        /*
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
        if (ctx.path === "/email-otp/send-verification-otp") {
          const email = (ctx.body as { email?: unknown } | undefined)?.email;
          if (typeof email !== "string" || isAllowedEmailAddress(email)) return;

          const existing = await ctx.context.internalAdapter.findUserByEmail(email.toLowerCase());
          if (existing) return;

          throw new APIError("FORBIDDEN", {
            code: EMAIL_DOMAIN_NOT_ALLOWED_CODE,
            message: NOT_ALLOWED_MESSAGE,
          });
        }

        /*
         * メールアドレス変更用のコード送信（COND-004 / COND-018）。
         * 大阪大学のドメイン以外は拒否し、アカウントの有無による例外は適用しない。
         */
        if (ctx.path === "/email-otp/request-email-change") {
          const newEmail = (ctx.body as { newEmail?: unknown } | undefined)?.newEmail;
          const res = checkRequestEmailChangeRule(newEmail);
          if (res.isErr()) {
            throw new APIError("FORBIDDEN", {
              code: res.error.code,
              message: res.error.message,
            });
          }
          return;
        }

        /*
         * ユーザー名の更新（COND-017 / UC-029）。
         */
        if (ctx.path === "/update-user") {
          const body = (ctx.body ?? {}) as { name?: unknown };
          const res = applyUpdateUserRule(body);
          if (res.isErr()) {
            throw new APIError("BAD_REQUEST", {
              code: res.error.code,
              message: res.error.message,
            });
          }
          return { context: { body: res.value.body } };
        }

        /*
         * パスキーの登録検証（COND-020）。
         * クライアントからの名前を消して空文字にし、サーバー側で命名した名前を採用させる。
         */
        if (ctx.path === "/passkey/verify-registration") {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const { body: updatedBody } = applyVerifyRegistrationRule(body);
          return { context: { body: updatedBody } };
        }

        /*
         * パスキー名の更新（COND-020 / UC-030）。
         */
        if (ctx.path === "/passkey/update-passkey") {
          const body = (ctx.body ?? {}) as { name?: unknown };
          const res = applyUpdatePasskeyRule(body);
          if (res.isErr()) {
            throw new APIError("BAD_REQUEST", {
              code: res.error.code,
              message: res.error.message,
            });
          }
          return { context: { body: res.value.body } };
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        /*
         * メールアドレスの切り替えが済んだ後の処理（EVT-016 / COND-018）。
         * 変更前のアドレスへの通知と、変更に使った端末以外のログアウトを行う。
         *
         * 失敗した切り替え（コードの誤りなど）では何もしない。
         * 成否は、エンドポイントが返した値が APIError かどうかで分かる。
         */
        if (ctx.path !== "/email-otp/change-email") return;
        if (ctx.context.returned instanceof APIError) return;

        /*
         * `ctx.context.session` は、エンドポイントの前に sensitiveSessionMiddleware が入れた
         * **切り替え前の**セッション。だから `user.email` は変更前のアドレスになる。
         * 切り替えの後に DB から読み直すと、もう新しいアドレスしか残っていない。
         */
        const session = ctx.context.session;
        const newEmail = (ctx.body as { newEmail?: unknown } | undefined)?.newEmail;

        if (!session || typeof newEmail !== "string") {
          // 成功した切り替えでここに来ることは無いはず。来たら通知もログアウトもできていないので、必ず残す
          logFailure({
            level: "error",
            where: "auth.change-email.after",
            code: "EMAIL_CHANGE_AFTER_WITHOUT_SESSION",
            kind: ErrorKind.Internal,
            userId: session?.user.id ?? "",
            message: "メールアドレスの切り替えの後処理で、切り替え前のセッションを読めなかった。",
          });
          return;
        }

        const db = createDb(env.DB);
        const finishEmailChange = createFinishEmailChangeUseCase({
          enqueueMails: (mails) => insertMailsAlone(db, mails),
          mailOutboxNotifier: createQueueMailOutboxNotifier(),
          sessionStore: ctx.context.internalAdapter,
          staffContactEmail: env.STAFF_CONTACT_EMAIL,
        });

        // 失敗はユースケースの中でログに残すので、ここでは待つだけ（例外は投げてこない）
        await finishEmailChange({
          userId: session.user.id,
          userName: session.user.name,
          previousEmail: session.user.email,
          newEmail: newEmail.toLowerCase(),
          currentToken: session.session.token,
          changedAt: new Date(),
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
         * advanced.backgroundTasks.handler により waitUntil でバックグラウンド実行されるため、
         * ここで例外を投げても HTTP レスポンスは 200 のまま。
         * 送信の失敗は Better Auth によりログに記録される。
         */
        async sendVerificationOTP({ email, otp, type }) {
          // メール送信の実装（worker-mailer）は `cloudflare:sockets` を読み込む。
          // Better Auth CLI はこの設定ファイルを Node.js 上で読むが、そのモジュールは
          // Workers 上にしか存在しないため、トップレベルで import すると CLI が
          // 設定を読み込めずスキーマ生成に失敗する。
          // 実行時にしか必要ない依存なので、ここで動的に読み込む。
          const { createMailSender, getMailFrom } =
            await import("~/infra/mail/mail-sender-factory.server");

          const sendVerificationOtp = createSendVerificationOtpUseCase({
            mailSender: createMailSender(),
            from: getMailFrom(),
          });

          const result = await sendVerificationOtp({ email, otp, type });

          if (result.isErr()) {
            // Better Auth 側にエラーを伝えるため、ここでは例外に変換する
            throw new Error(
              `認証コードのメール送信に失敗しました: ${formatSendEmailError(result.error)}`,
            );
          }
        },
      }),

      /**
       * パスキー（WebAuthn）でのログイン。
       *
       * rpID は指定しなければ baseURL のホスト名になる。
       * この値は登録済みのパスキー 1 つ 1 つに焼き付けられるため、
       * 後から変えると既存のパスキーが**すべて使えなくなる**点に注意。
       *
       * プレビューでは rpID が `iclub-preview.gdgoc-osaka.jp` になり、派生ブランチの Preview
       * （`<ブランチ名>.iclub-preview.gdgoc-osaka.jp`）はその配下にあるため、
       * develop で登録したパスキーがどのブランチでもそのまま使える（ADR-006）。
       */
      passkey({
        rpName: APP_NAME,
        origin: toPasskeyOrigin(env.APP_ENV, BETTER_AUTH_URL),

        authenticatorSelection: {
          /**
           * 端末側にユーザー情報ごと保存する形式（discoverable credential）を必須にする。
           *
           * 既定の "preferred" だと認証器によっては保存されないことがあり、
           * そうなるとメールアドレス欄のオートフィル候補にも、
           * メールアドレスを入力しないログインにも出てこないパスキーができてしまう。
           */
          residentKey: "required",

          // 生体認証・PIN の要求。"required" だと毎回必ず求められて煩わしいので既定のまま。
          userVerification: "preferred",
        },

        /**
         * パスキーの名前は、登録した人に入力させずにサーバーで付ける（COND-020）。
         *
         * ブラウザから届いた名前は `hooks.before` で空にしてあるので、ここで返した名前が保存される。
         * ブラウザから名前を渡すと、OS のパスキー保存ダイアログに出るアカウント名まで置き換わってしまうため。
         */
        registration: {
          afterVerification: ({ ctx, verification }) => ({
            name: toPasskeyName({
              aaguid: verification.registrationInfo?.aaguid,
              userAgent: ctx.headers?.get("user-agent") ?? ctx.request?.headers.get("user-agent"),
            }),
          }),
        },

        /**
         * パスキーでログインするたびに、そのパスキーを最後に使った日時を記録する（INFO-010）。
         *
         * 記録に失敗してもログインは止めない。一覧に出す日時が古くなるだけで、ログインの可否には関わらないため。
         */
        authentication: {
          afterVerification: async ({ verification }) => {
            try {
              await recordPasskeyUse(
                createDb(env.DB),
                verification.authenticationInfo.credentialID,
                new Date(),
              );
            } catch (cause) {
              logFailure({
                level: "error",
                where: "auth.passkey.after-authentication",
                code: "PASSKEY_LAST_USED_NOT_RECORDED",
                kind: ErrorKind.Internal,
                // ここではまだセッションが無く、誰のログインかはパスキーを引くまで分からない
                userId: "",
                message: "パスキーを最後に使った日時を記録できなかった。",
                cause,
              });
            }
          },
        },
      }),
    ],
  });
};

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
