/**
 * ローカルの D1 に開発用の初期データ（シード）を投入するスクリプト。
 *
 * ```bash
 * pnpm run db:seed
 * ```
 *
 * 投入する中身は `app/db/seed.ts` にある。何度実行してもよい。
 *
 * ## 仕組み
 *
 * Wrangler の `getPlatformProxy()` は、Cloudflare のバインディング（ここでは D1）を
 * Node.js から触れる形で用意してくれる。おかげで、アプリと**まったく同じ D1 の API**を
 * 通してシードできる。SQLite のファイルを直接開く方法と違い、
 * 「D1 では動かない書き方」をここで見逃すことがない。
 *
 * 参照するのは `wrangler.jsonc` のトップレベル（＝ローカル開発用）の設定なので、
 * 対象は `pnpm run db:migrate:local` と同じローカルの DB になる。
 * Cloudflare 上の DB は書き換えない。
 */
import { getPlatformProxy } from "wrangler";

import { seedDatabase } from "../app/db/seed";
import { createDb } from "../app/infra/db";

const main = async () => {
  // 型は worker-configuration.d.ts が生成する Env をそのまま使う
  const platform = await getPlatformProxy<Env>();

  try {
    const summary = await seedDatabase(createDb(platform.env.DB));

    console.log("ローカルの D1 にシードしました:");
    for (const [table, count] of Object.entries(summary)) {
      console.log(`  ${table}: ${count} 件`);
    }
  } finally {
    // miniflare のプロセスを畳む。呼ばないとコマンドが終わらない
    await platform.dispose();
  }
};

await main();
