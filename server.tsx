import { createAppRouter } from './app/router.tsx';

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    try {
      // In CF Workers/Pages, env contains our bindings like env.DB
      const router = createAppRouter(env);
      return await router.fetch(request, { env, ctx });
    } catch (error) {
      console.error(error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
};
