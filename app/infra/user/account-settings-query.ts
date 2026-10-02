import { and, desc, eq, gt } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { passkey, passkeyLastUsedTable, session } from "~/db/schema";
import { toDeviceName, toPasskeyLabel } from "~/domain/authn/device-name";
import { findPasskeyProvider } from "~/domain/authn/passkey-provider";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { AccountSettingsData, AccountSettingsQuery } from "~/query/user/account-settings";
import type { Database } from "../db";

/**
 * Cloudflare D1 (Drizzle) を使った AccountSettingsQuery の実装。
 *
 * - パスキーは passkey_last_used を leftJoin して取得し、登録日時の新しい順にソートする。
 * - セッションは有効期限（expiresAt）が未来のものだけを抽出し、最終利用日時の新しい順にソートする。
 * - セキュリティのため、トークンは一切取得・返却しない。
 */
export const createAccountSettingsQuery = (db: Database): AccountSettingsQuery => ({
  findByUserId: (userId, currentSessionId, now) => {
    return ResultAsync.fromPromise(
      Promise.all([
        db
          .select({
            id: passkey.id,
            name: passkey.name,
            aaguid: passkey.aaguid,
            credentialID: passkey.credentialID,
            backedUp: passkey.backedUp,
            createdAt: passkey.createdAt,
            lastUsedAt: passkeyLastUsedTable.lastUsedAt,
          })
          .from(passkey)
          .leftJoin(passkeyLastUsedTable, eq(passkey.id, passkeyLastUsedTable.passkeyId))
          .where(eq(passkey.userId, userId))
          .orderBy(desc(passkey.createdAt)),
        db
          .select({
            id: session.id,
            userAgent: session.userAgent,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          })
          .from(session)
          .where(and(eq(session.userId, userId), gt(session.expiresAt, now)))
          .orderBy(desc(session.updatedAt)),
      ]),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "アカウント設定情報の取得に失敗しました。",
        cause: error,
      }),
    ).map(([passkeyRows, sessionRows]): AccountSettingsData => ({
      passkeys: passkeyRows.map((row) => ({
        id: row.id,
        label: toPasskeyLabel({ name: row.name, aaguid: row.aaguid }),
        icon: findPasskeyProvider(row.aaguid)?.icon ?? null,
        credentialID: row.credentialID,
        backedUp: row.backedUp,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt ?? null,
      })),
      sessions: sessionRows.map((row) => ({
        id: row.id,
        deviceName: toDeviceName(row.userAgent),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        isCurrent: row.id === currentSessionId,
      })),
    }));
  },
});
