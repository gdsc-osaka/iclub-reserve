import { h } from 'preact';
import { RootLayout } from '../root';

export function AdminRoute({ user, pendingReservations }: { user: any; pendingReservations: any[] }) {
  const mockScript = `
    function submitAction(e, actionName) {
      e.preventDefault();
      const form = e.target;
      if (confirm('この予約を ' + actionName + ' しますか？')) {
        if (window.showToast) {
          window.showToast('処理が完了しました', 'success');
          window.showToast('団体へ通知メールを送信しました', 'info');
        }
        form.submit();
      }
    }
  `;

  return (
    <RootLayout title="事務局ダッシュボード - i-Club Reserve" user={user}>
      <script dangerouslySetInnerHTML={{ __html: mockScript }}></script>
      <script type="module" src="/assets/toast.js"></script>
      
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ margin: 0 }}>事務局ダッシュボード</h1>
        <p className="text-muted">現在承認待ちの予約一覧</p>
      </div>

      <div className="glass-panel" style={{ padding: '32px' }}>
        <h2 style={{ marginBottom: '24px' }}>承認待ちリスト</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {pendingReservations.length === 0 ? (
            <p className="text-muted">現在、承認が必要な予約はありません。</p>
          ) : (
            pendingReservations.map((res: any) => {
              const start = new Date(res.start_at).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
              const end = new Date(res.end_at).toLocaleTimeString('ja-JP', { timeStyle: 'short' });
              
              return (
                <div key={res.id} className="glass-panel" style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <div className="badge badge-provisional">承認待ち</div>
                      <div style={{ fontWeight: '600', fontSize: '1.1rem' }}>{res.facility_name}</div>
                    </div>
                    <div className="text-muted" style={{ marginBottom: '4px' }}>
                      団体名: <span style={{ color: 'var(--color-text-primary)' }}>{res.group_name}</span> | 申請者: {res.created_by_name}
                    </div>
                    <div className="text-muted" style={{ marginBottom: '4px' }}>
                      日時: {start} 〜 {end}
                    </div>
                    <div className="text-muted" style={{ fontSize: '0.9rem' }}>
                      利用人数: {res.headcount}名 | 備考: {res.note || 'なし'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '12px' }}>
                    <form method="post" action={`/admin/reservations/${res.id}/approve`} onsubmit={"submitAction(event, '承認')"} {...{ onsubmit: "submitAction(event, '承認')" } as any}>
                      <button type="submit" className="btn">
                        承認する
                      </button>
                    </form>
                    <form method="post" action={`/admin/reservations/${res.id}/reject`} onsubmit={"submitAction(event, '却下')"} {...{ onsubmit: "submitAction(event, '却下')" } as any}>
                      <button type="submit" className="btn btn-danger">
                        却下する
                      </button>
                    </form>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </RootLayout>
  );
}
