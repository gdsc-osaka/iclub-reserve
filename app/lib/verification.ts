import type { KVNamespace } from "@cloudflare/workers-types";

const VERIFICATION_TTL = 60 * 30; // 30 minutes

export function generateVerificationCode(): string {
  const digits = crypto.getRandomValues(new Uint8Array(3));
  // 6桁のコードを生成（000000〜999999）
  const code = (
    (digits[0] * 65536 + digits[1] * 256 + digits[2]) %
    1_000_000
  )
    .toString()
    .padStart(6, "0");
  return code;
}

export async function storeVerificationCode(
  kv: KVNamespace,
  email: string,
  code: string,
  pendingData: Record<string, string>,
): Promise<void> {
  await kv.put(
    `verify:${email}`,
    JSON.stringify({ code, ...pendingData }),
    { expirationTtl: VERIFICATION_TTL },
  );
}

export async function verifyCode(
  kv: KVNamespace,
  email: string,
  code: string,
): Promise<Record<string, string> | null> {
  const raw = await kv.get(`verify:${email}`);
  if (!raw) return null;

  const stored = JSON.parse(raw) as Record<string, string>;
  if (stored.code !== code) return null;

  await kv.delete(`verify:${email}`);
  return stored;
}
