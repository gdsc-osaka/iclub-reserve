import type { RequestContext } from 'remix/fetch-router';
import { render } from './utils/render.tsx';
import { AppShell, PageHeader } from './layout.tsx';
import { currentUserKey, dbKey, formatDate } from './utils/context.ts';
import { getAllFacilities, getReservationsForCalendar } from './utils/db.ts';
import type { Reservation } from './utils/context.ts';

// ── Calendar page ──────────────────────────────────────────────────

export async function calendarPage(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db = ctx.storage.get(dbKey)!;

  // Parse year/month from query, default to current month
  const now = new Date();
  const year  = parseInt(ctx.url.searchParams.get('year')  ?? String(now.getFullYear()), 10);
  const month = parseInt(ctx.url.searchParams.get('month') ?? String(now.getMonth() + 1), 10);
  const facilityFilter = ctx.url.searchParams.get('facility') ?? '';

  const [facilities, reservations] = await Promise.all([
    getAllFacilities(db, true),
    getReservationsForCalendar(db, year, month),
  ]);

  // Filter by facility if requested
  const filtered = facilityFilter
    ? reservations.filter(r => r.facility_id === facilityFilter)
    : reservations;

  // Build calendar grid
  const firstDay = new Date(year, month - 1, 1);
  const lastDay  = new Date(year, month, 0);
  const startDow = firstDay.getDay(); // 0=Sun

  // Group reservations by date (YYYY-MM-DD)
  const byDate: Record<string, (Reservation & { group_name: string; facility_name: string })[]> = {};
  for (const r of filtered) {
    const dateKey = r.start_at.slice(0, 10);
    (byDate[dateKey] ??= []).push(r);
  }

  // Prev/next month navigation
  const prevYear  = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Build calendar cells
  const cells: { date: Date | null }[] = [];
  for (let i = 0; i < startDow; i++) cells.push({ date: null });
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push({ date: new Date(year, month - 1, d) });
  while (cells.length % 7 !== 0) cells.push({ date: null });

  return render(
    <AppShell title="カレンダー" user={user}>
      <PageHeader
        title="空き状況カレンダー"
        subtitle="承認済み・仮予約を表示"
        action={
          <a href="/reservations/new" class="btn btn-primary">
            ＋ 新規予約
          </a>
        }
      />

      {/* Facility filter */}
      <form method="get" class="flex-center gap-8 mb-16">
        <input type="hidden" name="year"  value={String(year)} />
        <input type="hidden" name="month" value={String(month)} />
        <select name="facility" class="form-select" style="max-width:300px">
          <option value="">すべての施設・設備</option>
          {facilities.map(f => (
            <option value={f.id} selected={facilityFilter === f.id}>{f.name}</option>
          ))}
        </select>
        <button type="submit" class="btn btn-outline">絞り込み</button>
      </form>

      {/* Month navigation */}
      <div class="cal-nav">
        <a href={`/calendar?year=${prevYear}&month=${prevMonth}&facility=${facilityFilter}`}
          class="btn btn-outline btn-sm">← 前月</a>
        <h2>{year}年{month}月</h2>
        <a href={`/calendar?year=${nextYear}&month=${nextMonth}&facility=${facilityFilter}`}
          class="btn btn-outline btn-sm">翌月 →</a>
      </div>

      {/* Calendar table */}
      <div class="card">
        <table class="cal-table">
          <thead>
            <tr>
              {['日','月','火','水','木','金','土'].map(d => <th>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: cells.length / 7 }, (_, week) => (
              <tr>
                {cells.slice(week * 7, week * 7 + 7).map(cell => {
                  if (!cell.date) return <td style="background:#f9fafb"></td>;
                  const dateStr = `${cell.date.getFullYear()}-${String(cell.date.getMonth() + 1).padStart(2, '0')}-${String(cell.date.getDate()).padStart(2, '0')}`;
                  const dayReservations = byDate[dateStr] ?? [];
                  const isToday = dateStr === todayStr;
                  return (
                    <td>
                      <div class={`cal-day-num${isToday ? ' today' : ''}`}>{cell.date.getDate()}</div>
                      {dayReservations.map(r => (
                        <a href={`/reservations/${r.id}`} class={`cal-event ${r.status}`}>
                          {r.facility_name.split('：').pop() ?? r.facility_name}：{r.group_name}
                        </a>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div class="flex-center gap-12 mt-16" style="font-size:.82rem">
        <span><span class="cal-event approved" style="display:inline">■</span> 承認済み</span>
        <span><span class="cal-event provisional" style="display:inline">■</span> 仮予約</span>
      </div>
    </AppShell>,
  );
}
