import { drizzle } from "drizzle-orm/d1";

import * as schema from "~/db/schema";

/** Cloudflare D1 のバインディングから Drizzle のクライアントを生成する */
export const createDb = (d1: D1Database) => drizzle(d1, { schema });

/** アプリケーション全体で使う DB クライアントの型 */
export type Database = ReturnType<typeof createDb>;
