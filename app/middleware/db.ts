export function injectDb(env: any) {
  return async (request: Request, next: () => Promise<Response>) => {
    // Cloudflare Pages / Workers injects the binding into context or env
    // For Remix v3 experimental router, we attach it to a custom property so it can be accessed
    (request as any).db = env.DB;
    return await next();
  };
}
