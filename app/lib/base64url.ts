/**
 * Base64URL エンコードを行う純粋関数（パディングの `=` は付けない）。
 *
 * Google の Service Account の JWT と、カレンダー購読のトークン（ADR-013 決定 3）で使う。
 */
export const base64UrlEncode = (data: Uint8Array | string): string => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
