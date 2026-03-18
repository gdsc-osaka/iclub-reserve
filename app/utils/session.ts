import { Session } from 'remix/session';
import { createCookieSessionStorage } from 'remix/session/cookie-storage';
import { createCookie } from 'remix/cookie';

export { Session };

export const sessionCookie = createCookie('__session', {
  secrets: ['s3cr3t'],
  sameSite: 'Lax',
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days
  httpOnly: true,
});

export const sessionStorage = createCookieSessionStorage();

export async function getSession(request: any) {
  const cookie = request.headers.get('Cookie');
  return sessionStorage.read(cookie);
}

export async function requireUser(request: Request, db: any) {
  const session = await getSession(request);
  const userId = session.get('userId');
  if (!userId) {
    throw new Response('Unauthorized', { status: 401 });
  }

  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
  if (!user) {
    throw new Response('Unauthorized', { status: 401 });
  }

  return user;
}
