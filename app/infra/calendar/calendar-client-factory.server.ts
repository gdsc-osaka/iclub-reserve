import { env } from "cloudflare:workers";
import type { CalendarClient } from "~/domain/calendar";
import { createConsoleCalendarClient } from "./console-calendar-client";
import { createGoogleCalendarClient } from "./google-calendar-client";
import { createGoogleTokenSource, type GoogleTokenSource } from "./google-service-account-token";

/**
 * Google Calendar 連携まわりの秘密情報（`.dev.vars` や `wrangler secret put` で渡す）。
 *
 * `wrangler types` が生成する `Env` には未設定の環境の値が載らないため、
 * あってもなくてもよい値として読む。
 */
export type CalendarSecrets = {
  readonly GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  readonly GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
};

/**
 * モジュールスコープに保持する TokenSource。
 *
 * access token は期限の 60 秒前まで保持して使い回す。
 */
let sharedTokenSource: GoogleTokenSource | null = null;
let currentEmail: string | null = null;
let currentKey: string | null = null;

/** Google Calendar と通信せずコンソールに出力する実装へフォールバックする */
const fallbackToConsole = (reason: string): CalendarClient => {
  console.warn(`${reason}のため、Google Calendar と連携せずコンソールに出力します。`);
  return createConsoleCalendarClient();
};

/**
 * 実行環境や設定に応じた CalendarClient を組み立てる。
 *
 * 必要な秘密情報（GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY）が
 * 未設定の場合はコンソール出力クライアントにフォールバックする。
 */
export const createCalendarClient = (): CalendarClient => {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL: email, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey } =
    env as Env & CalendarSecrets;

  if (!email || !privateKey) {
    return fallbackToConsole(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY が未設定",
    );
  }

  // 認証情報が切り替わった場合（テスト等）は TokenSource を再生成
  if (!sharedTokenSource || currentEmail !== email || currentKey !== privateKey) {
    currentEmail = email;
    currentKey = privateKey;
    sharedTokenSource = createGoogleTokenSource({
      serviceAccountEmail: email,
      privateKeyPem: privateKey,
    });
  }

  return createGoogleCalendarClient({
    fetchFn: fetch,
    getAccessToken: (options) => sharedTokenSource!.getAccessToken(options),
    appEnv: env.APP_ENV ?? "local",
  });
};

/**
 * カレンダーの書き込み権限を付与すべき Service Account のメールアドレスを取得する。
 *
 * 施設管理画面で管理者に「このメールアドレスにカレンダーを共有してください」と案内するために使用する。
 * 未設定時は null を返す。
 */
export const getCalendarWriterEmail = (): string | null => {
  const { GOOGLE_SERVICE_ACCOUNT_EMAIL: email } = env as Env & CalendarSecrets;
  return email ?? null;
};
