import { base64UrlEncode } from "./base64url";

/**
 * 暗号論的に安全な乱数トークンを生成する（ADR-013 決定 3）。
 *
 * crypto.getRandomValues で 32 バイト（256 ビット）の乱数を作り、
 * base64url（パディングなし）の 43 文字にする。総当たりで推測することはできない。
 */
export function generateRandomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
