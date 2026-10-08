import { describe, expect, it, vi } from "vitest";
import { CalendarErrorCode } from "~/domain/calendar";
import {
  createGoogleTokenSource,
  createSignedServiceAccountJwt,
  GOOGLE_CALENDAR_EVENTS_SCOPE,
  GOOGLE_OAUTH2_TOKEN_URL,
} from "./google-service-account-token";

/** ArrayBuffer を PEM 形式の文字列にするヘルパー */
const derToPem = (der: ArrayBuffer, header: string, footer: string): string => {
  const binary = Array.from(new Uint8Array(der), (b) => String.fromCharCode(b)).join("");
  const base64 = btoa(binary);
  const formatted = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
  return `-----BEGIN ${header}-----\n${formatted}\n-----END ${footer}-----`;
};

describe("google-service-account-token", () => {
  const generateTestKeyPair = async () => {
    return (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
  };

  it("RSA 鍵ペアを生成して JWT を署名し、公開鍵で検証できる", async () => {
    const keyPair = await generateTestKeyPair();
    const pkcs8Der = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const privateKeyPem = derToPem(pkcs8Der, "PRIVATE KEY", "PRIVATE KEY");

    const now = new Date("2026-10-08T10:00:00Z");
    const serviceAccountEmail = "test-service-account@example.iam.gserviceaccount.com";

    const jwt = await createSignedServiceAccountJwt({
      serviceAccountEmail,
      privateKeyPem,
      now,
    });

    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);
    const [headerB64, payloadB64, signatureB64] = parts;

    // ヘッダーの検証
    const header = JSON.parse(atob(headerB64.replace(/-/g, "+").replace(/_/g, "/")));
    expect(header).toEqual({ alg: "RS256", typ: "JWT" });

    // ペイロードの検証
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    expect(payload.iss).toBe(serviceAccountEmail);
    expect(payload.scope).toBe(GOOGLE_CALENDAR_EVENTS_SCOPE);
    expect(payload.aud).toBe(GOOGLE_OAUTH2_TOKEN_URL);
    expect(payload.iat).toBe(Math.floor(now.getTime() / 1000));
    expect(payload.exp).toBe(Math.floor(now.getTime() / 1000) + 3600);

    // 署名の検証
    const unsignedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signatureBinary = atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/"));
    const signatureBytes = new Uint8Array(signatureBinary.length);
    for (let i = 0; i < signatureBinary.length; i++) {
      signatureBytes[i] = signatureBinary.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      keyPair.publicKey,
      signatureBytes,
      unsignedData,
    );
    expect(isValid).toBe(true);
  });

  it("\\n の 2 文字で改行が渡された PEM も正常に署名できる", async () => {
    const keyPair = await generateTestKeyPair();
    const pkcs8Der = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const normalPem = derToPem(pkcs8Der, "PRIVATE KEY", "PRIVATE KEY");
    const escapedPem = normalPem.replace(/\n/g, "\\n");

    const now = new Date("2026-10-08T10:00:00Z");
    const jwt = await createSignedServiceAccountJwt({
      serviceAccountEmail: "test@example.com",
      privateKeyPem: escapedPem,
      now,
    });

    expect(jwt.split(".")).toHaveLength(3);
  });

  describe("createGoogleTokenSource", () => {
    it("トークンの取得、キャッシュ保持、期限前の再利用、期限切れ時の再取得が正しく動作する", async () => {
      const keyPair = await generateTestKeyPair();
      const pkcs8Der = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
      const privateKeyPem = derToPem(pkcs8Der, "PRIVATE KEY", "PRIVATE KEY");

      let currentTime = new Date("2026-10-08T10:00:00Z");
      const getNow = () => currentTime;

      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        return new Response(
          JSON.stringify({
            access_token: `mock_token_${callCount}`,
            expires_in: 3600, // 3600 秒（有効期限は 3600 - 60 = 3540 秒後）
            token_type: "Bearer",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const tokenSource = createGoogleTokenSource({
        serviceAccountEmail: "sa@example.com",
        privateKeyPem,
        fetchFn: mockFetch as unknown as typeof fetch,
        getNow,
      });

      // 1回目の取得: fetch が呼ばれる
      const token1Result = await tokenSource.getAccessToken();
      expect(token1Result.isOk()).toBe(true);
      expect(token1Result._unsafeUnwrap()).toBe("mock_token_1");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // 10分後 (まだ 3540 秒以内): キャッシュが再利用され、fetch は呼ばれない
      currentTime = new Date(currentTime.getTime() + 10 * 60 * 1000);
      const token2Result = await tokenSource.getAccessToken();
      expect(token2Result.isOk()).toBe(true);
      expect(token2Result._unsafeUnwrap()).toBe("mock_token_1");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // forceRefresh: true を指定すると期限前でも fetch が呼ばれて新しい token になる
      const token3Result = await tokenSource.getAccessToken({ forceRefresh: true });
      expect(token3Result.isOk()).toBe(true);
      expect(token3Result._unsafeUnwrap()).toBe("mock_token_2");
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // 期限（3540秒後）を過ぎた場合: 自動で再取得される
      currentTime = new Date(currentTime.getTime() + 3550 * 1000);
      const token4Result = await tokenSource.getAccessToken();
      expect(token4Result.isOk()).toBe(true);
      expect(token4Result._unsafeUnwrap()).toBe("mock_token_3");
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it("OAuth エンドポイントがエラーを返した場合は CalendarError を返す", async () => {
      const keyPair = await generateTestKeyPair();
      const pkcs8Der = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
      const privateKeyPem = derToPem(pkcs8Der, "PRIVATE KEY", "PRIVATE KEY");

      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "invalid_grant",
            error_description: "Invalid JWT Signature.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      );

      const tokenSource = createGoogleTokenSource({
        serviceAccountEmail: "sa@example.com",
        privateKeyPem,
        fetchFn: mockFetch as unknown as typeof fetch,
      });

      const result = await tokenSource.getAccessToken();
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(CalendarErrorCode.Rejected);
    });
  });
});
