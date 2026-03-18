import { drizzle } from "drizzle-orm/d1";
import type { CloudflareEnv } from "~/types/cloudflare";
import * as schema from "./schema";

export function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema });
}

export type Database = ReturnType<typeof getDb>;
