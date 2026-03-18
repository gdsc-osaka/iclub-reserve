import type { User } from './utils/context.ts';

interface LayoutProps {
  title: string;
  user: User | null;
  children: unknown;
}

// Remix v3 components: (handle) => (props) => JSX
export function AppShell(_handle: unknown) {
  return ({ title, user, children }: LayoutProps) => (
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} — iclub-reserve</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <div class="app-shell">
          {user ? <AuthSidebar user={user} /> : null}
          <div class="main">
            <div class="page">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}

function AuthSidebar(_handle: unknown) {
  return ({ user }: { user: User }) => {
    const isStaff = !!user.is_staff;
    return (
      <nav class="sidebar">
        <div class="sidebar-logo">
          i<span>Club</span> Reserve
        </div>

        <div class="sidebar-nav">
          <div class="sidebar-section">予約</div>
          <a href="/calendar">📅 カレンダー</a>
          <a href="/reservations">📋 予約一覧</a>
          <a href="/reservations/new">＋ 新規予約</a>

          <div class="sidebar-section">管理</div>
          <a href="/groups">👥 団体</a>
          {isStaff ? <a href="/facilities">🏢 施設管理</a> : null}

          <div class="sidebar-section" style="margin-top:auto"></div>
          <form method="post" action="/logout">
            <button type="submit" class="btn-ghost">🚪 ログアウト</button>
          </form>
        </div>

        <div class="sidebar-user">
          <strong>{user.name}</strong>
          {user.email}
          {isStaff ? <span class="badge badge-staff" style="margin-top:4px;display:inline-block">事務局</span> : null}
        </div>
      </nav>
    );
  };
}

/** Inline page header with title and optional action button */
export function PageHeader(_handle: unknown) {
  return ({
    title,
    subtitle,
    action,
  }: {
    title: string;
    subtitle?: string;
    action?: unknown;
  }) => (
    <div class="flex-center gap-12 mb-24">
      <div style="flex:1">
        <h1 style="font-size:1.4rem;font-weight:700">{title}</h1>
        {subtitle ? <p class="text-muted text-sm mt-4">{subtitle}</p> : null}
      </div>
      {action ?? null}
    </div>
  );
}
