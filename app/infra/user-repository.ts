import { eq } from "drizzle-orm";
import { ResultAsync } from "neverthrow";

import { user } from "~/db/schema";
import type { User, UserId } from "~/domain/user";
import { databaseError } from "~/domain/user-error";
import type { UserRepository } from "~/domain/user-repository";
import type { Database } from "./db";

/** users テーブルの 1 行を、ドメインモデルの User に変換する */
const toUser = (row: typeof user.$inferSelect): User => ({
  id: row.id,
  email: row.email,
  name: row.name,
  isStaff: row.is_staff,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Cloudflare D1 (Drizzle) を使った UserRepository の実装。
 *
 * domain 層の UserRepository インターフェースを満たすオブジェクトを返す。
 * DB クライアントを引数で受け取るので、呼び出し側が接続先を差し替えられる。
 */
export const createUserRepository = (db: Database): UserRepository => ({
  findById: (id: UserId) =>
    // fromPromise で「例外を投げる世界」から「Result を返す世界」へ橋渡しする。
    // ここが try-catch を書く唯一の場所になる。
    ResultAsync.fromPromise(
      db.select().from(user).where(eq(user.id, id)).limit(1),
      databaseError,
    ).map((rows) => {
      const row = rows.at(0);
      return row === undefined ? undefined : toUser(row);
    }),
});
