import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { CalendarErrorCode, type CalendarError } from "~/domain/calendar";
import { classifyGoogleCalendarError } from "./google-calendar-error";

/** OAuth 2.0 トークンエンドポイント */
export const GOOGLE_OAUTH2_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Google Calendar のスコープ（予定の読み書き権限） */
export const GOOGLE_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";

/**
 * Base64URL エンコードを行う純粋関数。
 */
export const base64UrlEncode = (data: Uint8Array | string): string => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * PEM 形式の PKCS#8 秘密鍵をバイナリ（DER）に変換する純粋関数。
 *
 * 環境変数等で改行が `\n` の 2 文字で渡される場合にも対応する。
 */
export const pemToPkcs8Der = (pem: string): ArrayBuffer => {
  // `\n` の 2 文字を本物の改行に置換
  const normalized = pem.replaceAll("\\n", "\n");
  const base64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replaceAll(/\s+/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
};

/**
 * RS256 用の署名付き JWT を生成する。
 */
export const createSignedServiceAccountJwt = async ({
  serviceAccountEmail,
  privateKeyPem,
  now,
}: {
  serviceAccountEmail: string;
  privateKeyPem: string;
  now: Date;
}): Promise<string> => {
  const der = pemToPkcs8Der(privateKeyPem);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const nowSeconds = Math.floor(now.getTime() / 1000);
  const payload = {
    iss: serviceAccountEmail,
    scope: GOOGLE_CALENDAR_EVENTS_SCOPE,
    aud: GOOGLE_OAUTH2_TOKEN_URL,
    exp: nowSeconds + 3600, // 1 時間有効
    iat: nowSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    new TextEncoder().encode(unsignedToken),
  );

  const signature = base64UrlEncode(new Uint8Array(signatureBuffer));
  return `${unsignedToken}.${signature}`;
};

/** Google OAuth 2.0 トークンエンドポイントの応答型 */
interface TokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly token_type?: string;
}

/** トークン保持（キャッシュ）のエントリ */
interface CachedToken {
  readonly token: string;
  readonly expiresAtMs: number;
}

export interface GoogleTokenSourceOptions {
  readonly serviceAccountEmail: string;
  readonly privateKeyPem: string;
  readonly fetchFn?: typeof fetch;
  readonly getNow?: () => Date;
}

export interface GoogleTokenSource {
  getAccessToken(options?: { forceRefresh?: boolean }): ResultAsync<string, CalendarError>;
  /** キャッシュを明示的にクリアする（401 発生時やテスト用） */
  clearCache(): void;
}

/**
 * Google Service Account のアクセストークンを取得・保持・再利用する TokenSource を作成する。
 *
 * - access token は期限の 60 秒前まで保持して使い回す。
 * - forceRefresh: true または clearCache() で破棄して再取得できる。
 * - fetchFn と getNow はテスト等で差し替え可能。
 */
export const createGoogleTokenSource = ({
  serviceAccountEmail,
  privateKeyPem,
  fetchFn = fetch,
  getNow = () => new Date(),
}: GoogleTokenSourceOptions): GoogleTokenSource => {
  let cached: CachedToken | null = null;

  const clearCache = () => {
    cached = null;
  };

  const getAccessToken = (
    options: { forceRefresh?: boolean } = {},
  ): ResultAsync<string, CalendarError> => {
    const now = getNow();

    if (!options.forceRefresh && cached !== null && now.getTime() < cached.expiresAtMs) {
      return okAsync(cached.token);
    }

    // キャッシュを破棄して新しく取得
    clearCache();

    return ResultAsync.fromPromise(
      createSignedServiceAccountJwt({
        serviceAccountEmail,
        privateKeyPem,
        now,
      }),
      (err): CalendarError => ({
        code: CalendarErrorCode.AuthFailed,
        message: "Google Service Account 秘密鍵による JWT 署名に失敗しました。",
        userMessage: "Google Calendar の認証設定に誤りがあります。管理者に問い合わせてください。",
        cause: err,
      }),
    ).andThen((assertion) => {
      const bodyParams = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      });

      return ResultAsync.fromPromise(
        fetchFn(GOOGLE_OAUTH2_TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: bodyParams.toString(),
        }),
        (err): CalendarError => ({
          code: CalendarErrorCode.Unavailable,
          message: "Google OAuth 2.0 トークンエンドポイントとの通信に失敗しました。",
          cause: err,
        }),
      ).andThen((response) =>
        ResultAsync.fromPromise(
          response.text().then((text) => ({ status: response.status, text })),
          (err): CalendarError => ({
            code: CalendarErrorCode.Unavailable,
            message: "Google OAuth 2.0 応答の読み取りに失敗しました。",
            cause: err,
          }),
        ).andThen(({ status, text }) => {
          let parsedJson: unknown;
          try {
            parsedJson = JSON.parse(text);
          } catch {
            parsedJson = text;
          }

          if (status !== 200) {
            // トークンエンドポイントは、鍵やメールアドレスの誤り・時計のずれを 400（invalid_grant）や
            // 401（invalid_client）で返す。どちらも設定の誤りなので、再試行しない AuthFailed にそろえる。
            // 429 と 5xx だけは一時的な失敗として Calendar API と同じ分類に任せる
            if (status === 429 || status >= 500) {
              return errAsync(classifyGoogleCalendarError(status, parsedJson));
            }
            return errAsync<string, CalendarError>({
              code: CalendarErrorCode.AuthFailed,
              message: `Google OAuth 2.0 トークンエンドポイントが ${status} を返しました。`,
              cause: parsedJson,
            });
          }

          const tokenData = parsedJson as TokenResponse;
          if (!tokenData.access_token) {
            return errAsync<string, CalendarError>({
              code: CalendarErrorCode.AuthFailed,
              message: "Google OAuth 2.0 応答に access_token が含まれていません。",
              cause: parsedJson,
            });
          }

          const expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
          // 期限の 60 秒前までを有効期限とする
          const validDurationMs = Math.max(0, (expiresIn - 60) * 1000);
          cached = {
            token: tokenData.access_token,
            expiresAtMs: now.getTime() + validDurationMs,
          };

          return okAsync(tokenData.access_token);
        }),
      );
    });
  };

  return {
    getAccessToken,
    clearCache,
  };
};
