import { h } from 'preact';
import { RootLayout } from '../root';

export function FacilityRoute({ user, facility, reservations }: { user: any; facility: any; reservations: any[] }) {
  // Client script to handle mock toasts on interaction
  const mockScript = `
    function submitReservation(e) {
      e.preventDefault();
      const form = e.target;
      const data = new FormData(form);
      const startAt = data.get('date') + 'T' + data.get('startTime') + ':00Z';
      const endAt = data.get('date') + 'T' + data.get('endTime') + ':00Z';
      
      // Inject JS toast and then submit
      if (window.showToast) {
        window.showToast('申請を受け付けました', 'success');
        window.showToast('関係者へメールを送信しました', 'info');
      }

      form.submit();
    }
  `;

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  return (
    <RootLayout title={`${facility.name} - i-Club Reserve`} user={user}>
      <script dangerouslySetInnerHTML={{ __html: mockScript }}></script>
      <script type="module" src="/assets/toast.js"></script>
      
      <div style={{ marginBottom: '32px' }}>
        <a href="/facilities" className="btn btn-secondary" style={{ marginBottom: '16px' }}>← 施設一覧に戻る</a>
        <h1 style={{ margin: 0 }}>{facility.name}</h1>
        <p className="text-muted">{facility.description}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '32px' }}>
        {/* Reservation Form */}
        <div className="glass-panel" style={{ padding: '32px' }}>
          <h2 style={{ marginBottom: '24px' }}>仮予約の申請</h2>
          
          <form method="post" action={`/facilities/${facility.id}/reserve`} onsubmit={"submitReservation(event)"} {...{ onsubmit: "submitReservation(event)" } as any}>
            <div className="form-group">
              <label className="form-label">利用目的・備考 (任意)</label>
              <textarea name="note" className="form-textarea" placeholder="例: ロボット外装パーツ出力のため"></textarea>
            </div>
            
            <div className="form-group">
              <label className="form-label">利用人数</label>
              <input type="number" name="headcount" className="form-input" min="1" max="50" defaultValue="1" required />
            </div>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">利用日</label>
                <input type="date" name="date" className="form-input" defaultValue={todayStr} required />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">開始時間</label>
                <input type="time" name="startTime" className="form-input" defaultValue="10:00" required />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">終了時間</label>
                <input type="time" name="endTime" className="form-input" defaultValue="12:00" required />
              </div>
            </div>

            {!user && (
              <div style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '0.9rem' }}>
                予約を申請するにはログインが必要です。（左上の Home からデモ用アカウントでログインできます）
              </div>
            )}

            <button type="submit" className="btn" style={{ width: '100%' }} disabled={!user}>
              申請する
            </button>
          </form>
        </div>

        {/* Existing Reservations block */}
        <div>
          <h2 style={{ marginBottom: '24px' }}>予約状況</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {reservations.length === 0 ? (
              <p className="text-muted">現在の予約はありません。</p>
            ) : (
              reservations.map((res: any) => {
                const start = new Date(res.start_at).toLocaleString('ja-JP', { dateStyle: 'short', timeStyle: 'short' });
                const end = new Date(res.end_at).toLocaleTimeString('ja-JP', { timeStyle: 'short' });
                
                let badgeClass = 'badge-provisional';
                let statusLabel = '仮予約';
                if (res.status === 'approved') {
                  badgeClass = 'badge-approved';
                  statusLabel = '承認済';
                }
                
                return (
                  <div key={res.id} className="glass-panel" style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div className={`badge ${badgeClass}`}>{statusLabel}</div>
                      <div style={{ fontWeight: '500' }}>{res.group_name}</div>
                    </div>
                    <div>{start} 〜 {end}</div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </RootLayout>
  );
}
