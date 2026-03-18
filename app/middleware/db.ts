import type { Middleware } from 'remix/fetch-router';
import { dbKey } from '../utils/context.ts';

/** Inject the D1 database binding into request context. */
export function createDbMiddleware(db: D1Database): Middleware {
  return async (ctx, next) => {
    ctx.storage.set(dbKey, db);
    return next();
  };
}
