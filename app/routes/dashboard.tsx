import { h } from 'preact';
import { RootLayout } from '../root';

export function DashboardRoute({ user, reservations }: { user: any; reservations: any[] }) {
  const mockScript = `
    function submitCancel(e) {
      e.preventDefault();
      const form = e.target;
      if (confirm('本当にこの予約を取り消しますか？')) {
        if (window.showToast) {
          window.showToast('予約を取り消しました', 'info');
          window.showToast('事務局へ通知メールを送信しました', 'info');
        }
        form.submit();
      }
    }
  `;

  return (
    <RootLayout title="ユーザーダッシュボード - i-Club Reserve" user={user}>
      <script dangerouslySetInnerHTML={{ __html: mockScript }}></script>
      <script type="module" src="/assets/toast.js"></script>
      
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ margin: 0 }}>マイダッシュボード</h1>
        <p className="text-muted">あなたの団体が申請した予約の管理</p>
      </div>

      <div className="glass-panel" style={{ padding: '32px' }}>
        <h2 style={{ marginBottom: '24px' }}>予約一覧</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {reservations.length === 0 ? (
            <p className="text-muted">申請した予約はありません。</p>
          ) : (
            reservations.map((res: any) => {
              const start = new Date(res.start_at).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
              const end = new Date(res.end_at).toLocaleTimeString('ja-JP', { timeStyle: 'short' });
              
              let badgeClass = 'badge-provisional';
              let statusLabel = '受付済 (承認待ち)';
              if (res.status === 'approved') {
                badgeClass = 'badge-approved';
                statusLabel = '承認済';
              } else if (res.status === 'rejected') {
                badgeClass = 'badge-rejected';
                statusLabel = '却下済';
              } else if (res.status === 'cancelled' || res.status === 'withdrawn') {
                badgeClass = 'badge-rejected';
                statusLabel = '取り消し済 / キャンセル済';
              }
              
              const canCancel = res.status === 'provisional' || res.status === 'approved';

              return (
                <div key={res.id} className="glass-panel" style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <div className={`badge ${badgeClass}`}>{statusLabel}</div>
                      <div style={{ fontWeight: '600', fontSize: '1.1rem' }}>{res.facility_name}</div>
                    </div>
                    <div className="text-muted" style={{ marginBottom: '4px' }}>
                      {start} 〜 {end}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                      利用人数: {res.headcount}名 | 備考: {res.note || 'なし'}
                    </div>
                  </div>

                  {canCancel && (
                    <form method="post" action={`/reservations/${res.id}/cancel`} onsubmit={"submitCancel(event)"} {...{ onsubmit: "submitCancel(event)" } as any}>
                      <button type="submit" className="btn btn-danger">
                        取り消し
                      </button>
                    </form>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </RootLayout>
  );
}
