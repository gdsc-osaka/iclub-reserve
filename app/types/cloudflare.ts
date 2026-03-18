import type { D1Database, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

export interface CloudflareEnv {
  DB: D1Database;
  KV: KVNamespace;
  R2: R2Bucket;
  APP_URL: string;
  SESSION_SECRET: string;
  RESEND_API_KEY: string;
  CALENDAR_SERVICE_URL: string;
  CALENDAR_SERVICE_SECRET: string;
}

declare module "react-router" {
  interface AppLoadContext {
    cloudflare: {
      env: CloudflareEnv;
      ctx: ExecutionContext;
    };
  }
}
