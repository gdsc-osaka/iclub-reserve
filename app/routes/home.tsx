import { h } from 'preact';
import { RootLayout } from '../root';

export function HomeRoute({ user }: { user?: any }) {
  return (
    <RootLayout title="i-Club Reserve - Login" user={user}>
      <div style={{ maxWidth: '600px', margin: '40px auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: '3rem', margin: '0 0 16px', background: 'linear-gradient(to right, var(--color-brand-primary), var(--color-accent))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          i-Club Reserve
        </h1>
        <p className="text-muted" style={{ fontSize: '1.2rem', marginBottom: '40px' }}>
          大阪大学 先導的学際研究機構 (i-Club) 施設予約システム
        </p>

        <div className="glass-panel" style={{ padding: '40px' }}>
          <h2 style={{ marginBottom: '24px' }}>Demo Login</h2>
          <p className="text-muted" style={{ marginBottom: '32px' }}>
            デモ環境のため、パスワード入力なしでアカウントを選択してログインできます。
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <form method="post" action="/login">
              <input type="hidden" name="userId" value="usr_admin" />
              <button type="submit" className="btn" style={{ width: '100%', padding: '16px', fontSize: '1.1rem' }}>
                👤 事務局 (管理者) としてログイン
              </button>
            </form>
            
            <form method="post" action="/login">
              <input type="hidden" name="userId" value="usr_student1" />
              <button type="submit" className="btn btn-secondary" style={{ width: '100%', padding: '16px', fontSize: '1.1rem' }}>
                🎓 代表 学生A (団体オーナー) としてログイン
              </button>
            </form>

            <form method="post" action="/login">
              <input type="hidden" name="userId" value="usr_student2" />
              <button type="submit" className="btn btn-secondary" style={{ width: '100%', padding: '16px', fontSize: '1.1rem' }}>
                🎓 メンバー 学生B としてログイン
              </button>
            </form>
          </div>
        </div>
      </div>
    </RootLayout>
  );
}
