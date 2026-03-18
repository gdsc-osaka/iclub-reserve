import { createAppRouter, type Env } from './app/router.ts';

// Lazily initialise the router once per Worker cold start.
let appRouter: ReturnType<typeof createAppRouter> | null = null;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (!appRouter) {
      appRouter = createAppRouter(env);
    }

    try {
      return await appRouter.fetch(request);
    } catch (err) {
      if (err instanceof Response) return err;
      console.error('[worker] unhandled error:', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
