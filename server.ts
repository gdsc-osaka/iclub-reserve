import { createRequestHandler } from "@react-router/cloudflare";
import type { CloudflareEnv } from "./app/types/cloudflare";

// react-router build の成果物を使用
// `pnpm build` でビルド後に `wrangler dev` または `wrangler deploy` を実行する
// @ts-ignore - exists after `pnpm build`
import * as build from "./build/server/index.js";

const requestHandler = createRequestHandler({ build });

export default {
  async fetch(
    request: Request,
    env: CloudflareEnv,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const eventContext = {
      request,
      env,
      waitUntil: ctx.waitUntil.bind(ctx),
      passThroughOnException: ctx.passThroughOnException.bind(ctx),
      next: () => Promise.resolve(new Response("Not Found", { status: 404 })),
      params: {},
      data: {} as Record<string, unknown>,
      functionPath: "",
    } as EventContext<CloudflareEnv, string, Record<string, unknown>>;

    return requestHandler(eventContext);
  },
} satisfies ExportedHandler<CloudflareEnv>;
