// Simple cookie-based session management using D1 for storage.
// Session IDs are random UUIDs stored in an HttpOnly cookie.

export const SESSION_COOKIE = 'sid';

export function getSessionId(request: Request): string | null {
  const cookieHeader = request.headers.get('Cookie') ?? '';
  for (const part of cookieHeader.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k?.trim() === SESSION_COOKIE && v) return decodeURIComponent(v.trim());
  }
  return null;
}

export function setSessionCookie(headers: Headers, sessionId: string): void {
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`,
  );
}

export function clearSessionCookie(headers: Headers): void {
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

export function verifyPassword(stored: string, input: string): boolean {
  // Demo-only plain-text prefix; replace with bcrypt in production.
  if (stored.startsWith('plain:')) return stored.slice(6) === input;
  return false;
}
