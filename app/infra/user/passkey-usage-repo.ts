import { eq } from "drizzle-orm";

import { passkey, passkeyLastUsedTable } from "~/db/schema";
import type { Database } from "../db";

/**
 * パスキーでログインしたときに、そのパスキーを最後に使った日時を記録する（INFO-010.last_used_at）。
 *
 * 呼ぶのは Better Auth の passkey プラグインの `authentication.afterVerification` だけ。
 * そこで受け取れるのは資格情報の ID（`credential_id`）なので、そこからパスキーを引いて書く。
 * 見つからなければ何もしない（ログインの検証は通っているので、直前に削除された場合くらいしか起きない）。
 *
 * 失敗は例外のまま投げる。ログインを止めるかどうかは呼ぶ側が決める。
 *
 * @param credentialId WebAuthn の資格情報 ID（base64url。`passkey.credential_id` と同じ形）
 * @param usedAt ログインした日時
 */
export const recordPasskeyUse = async (
  db: Database,
  credentialId: string,
  usedAt: Date,
): Promise<void> => {
  const target = await db
    .select({ id: passkey.id })
    .from(passkey)
    .where(eq(passkey.credentialID, credentialId))
    .limit(1);

  const passkeyId = target.at(0)?.id;
  if (passkeyId === undefined) return;

  await db
    .insert(passkeyLastUsedTable)
    .values({ passkeyId, lastUsedAt: usedAt })
    .onConflictDoUpdate({ target: passkeyLastUsedTable.passkeyId, set: { lastUsedAt: usedAt } });
};
