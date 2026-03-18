import type { AppLoadContext } from "react-router";
import type { CloudflareEnv } from "~/types/cloudflare";

/**
 * ローダー/アクションから Cloudflare 環境を取得するヘルパー。
 * `vite dev`（Node.js）では context.cloudflare が undefined のため、
 * process.env にフォールバックする。
 */
export function getEnv(context: AppLoadContext): CloudflareEnv {
  if (context?.cloudflare?.env) {
    return context.cloudflare.env as CloudflareEnv;
  }
  // vite dev 用フォールバック（本番では到達しない）
  throw new Error(
    "Cloudflare environment not available. Use `pnpm dev:wrangler` for full Cloudflare bindings.",
  );
}
