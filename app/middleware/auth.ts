import type { Middleware } from 'remix/fetch-router';
import { currentUserKey, dbKey } from '../utils/context.ts';
import { getSessionId, clearSessionCookie } from '../utils/session.ts';
import { getUserFromSession } from '../utils/db.ts';

/** Optionally load the authenticated user into context. */
export function loadAuth(): Middleware {
  return async (ctx, next) => {
    const db = ctx.storage.get(dbKey);
    if (db) {
      const sessionId = getSessionId(ctx.request);
      if (sessionId) {
        const user = await getUserFromSession(db, sessionId);
        if (user) ctx.storage.set(currentUserKey, user);
      }
    }
    return next();
  };
}

/** Require authentication; redirect to login if not authenticated. */
export function requireAuth(): Middleware {
  return async (ctx, next) => {
    const user = ctx.storage.get(currentUserKey);
    if (!user) {
      return new Response(null, { status: 302, headers: { Location: `/login?returnTo=${encodeURIComponent(ctx.url.pathname)}` } });
    }
    return next();
  };
}

/** Require staff role; redirect to / if not staff. */
export function requireStaffMiddleware(): Middleware {
  return async (ctx, next) => {
    const user = ctx.storage.get(currentUserKey);
    if (!user || !user.is_staff) {
      return new Response(null, { status: 302, headers: { Location: '/' } });
    }
    return next();
  };
}
