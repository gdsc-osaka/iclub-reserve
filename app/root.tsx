import { h, ComponentChildren } from 'preact';

interface RootLayoutProps {
  title?: string;
  children: ComponentChildren;
  user?: any; // Mock user data
}

export function RootLayout({ title = 'i-Club Reserve', children, user }: RootLayoutProps) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="/assets/global.css" />
      </head>
      <body>
        <header className="header glass-panel" style={{ margin: '16px', borderRadius: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '32px', height: '32px', background: 'var(--color-brand-primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
              iR
            </div>
            <h2 style={{ fontSize: '1.2rem', margin: 0 }}>i-Club Reserve</h2>
          </div>
          
          <nav className="nav-links">
            <a href="/" className="nav-link">Home / Login</a>
            <a href="/facilities" className="nav-link">Facilities</a>
            {user && (
              <a href="/dashboard" className="nav-link">Dashboard</a>
            )}
            {user?.is_staff === 1 && (
              <a href="/admin" className="nav-link">Admin</a>
            )}
            {user && (
              <a href="/logout" className="btn btn-secondary" style={{ padding: '8px 16px', fontSize: '0.9rem' }}>
                Logout ({user.name})
              </a>
            )}
          </nav>
        </header>
        
        <main className="container">
          {children}
        </main>

        <div id="toast-root" className="toast-container"></div>
      </body>
    </html>
  );
}
