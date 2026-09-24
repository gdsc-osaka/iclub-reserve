import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { passkey } from "./auth";

/**
 * パスキーを最後に使った日時（INFO-010.last_used_at）。
 *
 * Better Auth の `passkey` テーブルはこの日時を持たない。
 * 列を足したくても、`app/db/schema/auth.ts` は Better Auth CLI が再生成のたびに上書きするので、
 * 自前の別テーブルに持つ。パスキーを削除すると、この行も一緒に消える（ON DELETE CASCADE）。
 *
 * 書くのは `app/infra/user/passkey-usage-repo.ts` の `recordPasskeyUse` だけ。
 */
export const passkeyLastUsedTable = sqliteTable("passkey_last_used", {
  passkeyId: text("passkey_id")
    .primaryKey()
    .references(() => passkey.id, { onDelete: "cascade" }),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }).notNull(),
});
