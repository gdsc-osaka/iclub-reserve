import { h } from 'preact';
import { RootLayout } from '../root';

interface Facility {
  id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  is_active: number;
}

export function FacilitiesRoute({ user, facilities }: { user: any; facilities: Facility[] }) {
  return (
    <RootLayout title="Facilities - i-Club Reserve" user={user}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div>
          <h1 style={{ margin: 0 }}>Facilities</h1>
          <p className="text-muted">予約可能な施設・設備の一覧</p>
        </div>
      </div>

      <div className="card-grid">
        {facilities.map((facility) => (
          <div key={facility.id} className="card glass-panel" style={{ display: 'flex', flexDirection: 'column' }}>
            {facility.photo_url ? (
              <img src={facility.photo_url} alt={facility.name} className="card-image" />
            ) : (
              <div className="card-image" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '3rem', background: 'linear-gradient(45deg, var(--color-bg-secondary), rgba(59, 130, 246, 0.2))' }}>
                🏢
              </div>
            )}
            
            <h3 style={{ margin: '0 0 8px 0' }}>{facility.name}</h3>
            <p className="text-muted" style={{ marginBottom: '24px', flex: 1 }}>
              {facility.description || '説明がありません'}
            </p>
            
            <a href={`/facilities/${facility.id}`} className="btn" style={{ width: '100%' }}>
              詳細・予約する
            </a>
          </div>
        ))}

        {facilities.length === 0 && (
          <div className="glass-panel" style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center' }}>
            <p className="text-muted">現在利用可能な施設はありません。</p>
          </div>
        )}
      </div>
    </RootLayout>
  );
}
