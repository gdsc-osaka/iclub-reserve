import type { RequestContext } from 'remix/fetch-router';
import { render } from './utils/render.tsx';
import { currentUserKey, dbKey } from './utils/context.ts';
import {
  getSessionId,
  setSessionCookie,
  clearSessionCookie,
  verifyPassword,
} from './utils/session.ts';
import { getUserByEmail, createSession, deleteSession } from './utils/db.ts';

// ── Login page ────────────────────────────────────────────────────

export async function loginPage(ctx: RequestContext): Promise<Response> {
  // Already logged in? redirect to calendar.
  const user = ctx.storage.get(currentUserKey);
  if (user) return new Response(null, { status: 302, headers: { Location: '/calendar' } });

  const returnTo = ctx.url.searchParams.get('returnTo') ?? '/calendar';
  const error = ctx.url.searchParams.get('error');

  return render(
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ログイン — iclub-reserve</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div class="login-wrap">
          <div class="login-card">
            <div class="login-logo">i<span>Club</span> Reserve</div>
            <div class="login-subtitle">Innovators' Club 施設予約システム</div>

            <div class="login-demo-accounts">
              <strong>🧪 デモアカウント（パスワード: demo1234）</strong>
              <table>
                <tr><td>事務局</td><td>staff@osaka-u.ac.jp</td></tr>
                <tr><td>団体A オーナー</td><td>alpha-owner@osaka-u.ac.jp</td></tr>
                <tr><td>団体A メンバー</td><td>alpha-member@osaka-u.ac.jp</td></tr>
                <tr><td>団体B オーナー</td><td>beta-owner@osaka-u.ac.jp</td></tr>
              </table>
            </div>

            {error === 'invalid' ? (
              <div class="alert alert-error">メールアドレスまたはパスワードが正しくありません。</div>
            ) : null}

            <form method="post" action={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
              <div class="form-group">
                <label class="form-label" for="email">メールアドレス</label>
                <input id="email" name="email" type="email" class="form-input"
                  placeholder="user@osaka-u.ac.jp" required />
              </div>
              <div class="form-group">
                <label class="form-label" for="password">パスワード</label>
                <input id="password" name="password" type="password" class="form-input"
                  placeholder="••••••••" required />
              </div>
              <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px">
                ログイン
              </button>
            </form>
          </div>
        </div>
      </body>
    </html>,
  );
}

// ── Login action ──────────────────────────────────────────────────

export async function loginAction(ctx: RequestContext): Promise<Response> {
  const db = ctx.storage.get(dbKey);
  if (!db) return new Response(null, { status: 302, headers: { Location: '/login?error=server' } });

  const data = ctx.formData;
  const email = (data.get('email') as string | null)?.trim().toLowerCase() ?? '';
  const password = (data.get('password') as string | null) ?? '';
  const returnTo = ctx.url.searchParams.get('returnTo') ?? '/calendar';

  const userWithHash = await db.prepare(
    'SELECT id, email, name, password_hash, is_staff FROM users WHERE email = ?',
  ).bind(email).first<{ id: string; email: string; name: string; password_hash: string; is_staff: number }>();

  if (!userWithHash || !verifyPassword(userWithHash.password_hash, password)) {
    return new Response(null, { status: 302, headers: { Location: `/login?error=invalid&returnTo=${encodeURIComponent(returnTo)}` } });
  }

  const sessionId = await createSession(db, userWithHash.id);
  const headers = new Headers({ Location: returnTo });
  setSessionCookie(headers, sessionId);
  return new Response(null, { status: 302, headers });
}

// ── Logout action ─────────────────────────────────────────────────

export async function logoutAction(ctx: RequestContext): Promise<Response> {
  const db = ctx.storage.get(dbKey);
  const sessionId = getSessionId(ctx.request);
  if (db && sessionId) await deleteSession(db, sessionId);

  const headers = new Headers({ Location: '/login' });
  clearSessionCookie(headers);
  return new Response(null, { status: 302, headers });
}
