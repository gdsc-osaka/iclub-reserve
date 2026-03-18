import type { RequestContext } from 'remix/fetch-router';
import { render } from './utils/render.tsx';
import { AppShell, PageHeader } from './layout.tsx';
import {
  currentUserKey, dbKey,
  statusLabel, formatDateTime, formatDate,
} from './utils/context.ts';
import {
  getAllReservations, getReservationsForGroup, getReservationById,
  getAllFacilities, getGroupsForUser, getMessages, checkOverlap,
} from './utils/db.ts';

// ── Reservation list ───────────────────────────────────────────────

export async function reservationList(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const statusFilter = ctx.url.searchParams.get('status') ?? '';

  // Staff sees all; group users see their own groups' reservations
  const reservations = user.is_staff
    ? await getAllReservations(db, statusFilter || undefined)
    : (await Promise.all(
        (await import('./utils/db.ts').then(m => m.getGroupsForUser(db, user.id)))
          .map(g => getReservationsForGroup(db, g.id))
      )).flat().sort((a, b) => b.start_at.localeCompare(a.start_at));

  const statuses: { value: string; label: string }[] = [
    { value: '',                   label: 'すべて' },
    { value: 'provisional',        label: '仮予約' },
    { value: 'approved',           label: '承認済み' },
    { value: 'withdrawn',          label: '取り消し済み' },
    { value: 'rejected',           label: '却下済み' },
    { value: 'cancelled',          label: 'キャンセル済み' },
    { value: 'cancelled_by_staff', label: '事務局キャンセル済み' },
  ];

  return render(
    <AppShell title="予約一覧" user={user}>
      <PageHeader
        title="予約一覧"
        action={<a href="/reservations/new" class="btn btn-primary">＋ 新規予約</a>}
      />

      {/* Filter by status */}
      <form method="get" class="flex-center gap-8 mb-16">
        <select name="status" class="form-select" style="max-width:200px">
          {statuses.map(s => (
            <option value={s.value} selected={statusFilter === s.value}>{s.label}</option>
          ))}
        </select>
        <button type="submit" class="btn btn-outline">絞り込み</button>
      </form>

      <div class="card">
        {reservations.length === 0 ? (
          <div class="empty-state">
            <p>該当する予約はありません。</p>
          </div>
        ) : (
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>施設・設備</th>
                  {user.is_staff ? <th>団体</th> : null}
                  <th>開始日時</th>
                  <th>終了日時</th>
                  <th>ステータス</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {reservations.map(r => (
                  <tr>
                    <td>{r.facility_name}</td>
                    {user.is_staff ? <td>{r.group_name}</td> : null}
                    <td>{formatDateTime(r.start_at)}</td>
                    <td>{formatDateTime(r.end_at)}</td>
                    <td>
                      <span class={`badge badge-${r.status}`}>{statusLabel(r.status)}</span>
                    </td>
                    <td>
                      <a href={`/reservations/${r.id}`} class="btn btn-outline btn-sm">詳細</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>,
  );
}

// ── New reservation form ───────────────────────────────────────────

export async function newReservationPage(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;

  const [facilities, groups] = await Promise.all([
    getAllFacilities(db, true),
    user.is_staff
      ? import('./utils/db.ts').then(m => m.getAllGroups(db))
      : import('./utils/db.ts').then(m => m.getGroupsForUser(db, user.id)),
  ]);

  if (!user.is_staff && groups.length === 0) {
    return render(
      <AppShell title="新規予約" user={user}>
        <PageHeader title="新規予約申請" />
        <div class="alert alert-warning">
          予約を申請するには、まず団体に所属する必要があります。
          <a href="/groups" class="btn btn-outline btn-sm" style="margin-left:12px">団体一覧を見る</a>
        </div>
      </AppShell>,
    );
  }

  const errorMsg = ctx.url.searchParams.get('error');
  const prefill = {
    facility_id: ctx.url.searchParams.get('facility') ?? '',
    group_id:    ctx.url.searchParams.get('group')    ?? '',
    start_date:  ctx.url.searchParams.get('start_date') ?? '',
    start_time:  ctx.url.searchParams.get('start_time') ?? '09:00',
    end_date:    ctx.url.searchParams.get('end_date')   ?? '',
    end_time:    ctx.url.searchParams.get('end_time')   ?? '10:00',
  };

  return render(
    <AppShell title="新規予約申請" user={user}>
      <PageHeader title="新規予約申請" />

      {errorMsg ? (
        <div class="alert alert-error">{errorMsg}</div>
      ) : null}

      <div class="card" style="max-width:600px">
        <div class="card-body">
          <form method="post" action="/reservations">
            <div class="form-group">
              <label class="form-label" for="facility_id">施設・設備 *</label>
              <select id="facility_id" name="facility_id" class="form-select" required>
                <option value="">選択してください</option>
                {facilities.map(f => (
                  <option value={f.id} selected={prefill.facility_id === f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            <div class="form-group">
              <label class="form-label" for="group_id">団体 *</label>
              <select id="group_id" name="group_id" class="form-select" required>
                <option value="">選択してください</option>
                {groups.map(g => (
                  <option value={g.id} selected={prefill.group_id === g.id}>{g.name}</option>
                ))}
              </select>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="start_date">開始日 *</label>
                <input id="start_date" name="start_date" type="date" class="form-input"
                  value={prefill.start_date} required />
              </div>
              <div class="form-group">
                <label class="form-label" for="start_time">開始時刻 *</label>
                <input id="start_time" name="start_time" type="time" class="form-input"
                  value={prefill.start_time} required />
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="end_date">終了日 *</label>
                <input id="end_date" name="end_date" type="date" class="form-input"
                  value={prefill.end_date} required />
              </div>
              <div class="form-group">
                <label class="form-label" for="end_time">終了時刻 *</label>
                <input id="end_time" name="end_time" type="time" class="form-input"
                  value={prefill.end_time} required />
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="headcount">使用人数</label>
              <input id="headcount" name="headcount" type="number" class="form-input"
                min="1" placeholder="例: 5" />
            </div>

            <div class="form-group">
              <label class="form-label" for="note">備考</label>
              <textarea id="note" name="note" class="form-textarea"
                placeholder="利用目的など"></textarea>
            </div>

            <div class="flex-center gap-8 mt-16">
              <button type="submit" class="btn btn-primary">申請する</button>
              <a href="/reservations" class="btn btn-outline">キャンセル</a>
            </div>
          </form>
        </div>
      </div>
    </AppShell>,
  );
}

// ── Create reservation action ──────────────────────────────────────

export async function createReservation(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;

  const data = ctx.formData;
  const facilityId = data.get('facility_id') as string;
  const groupId    = data.get('group_id')    as string;
  const startDate  = data.get('start_date')  as string;
  const startTime  = data.get('start_time')  as string;
  const endDate    = data.get('end_date')    as string;
  const endTime    = data.get('end_time')    as string;
  const headcount  = data.get('headcount')   as string;
  const note       = data.get('note')        as string;

  const startAt = `${startDate}T${startTime}:00Z`;
  const endAt   = `${endDate}T${endTime}:00Z`;

  // Validation
  if (!facilityId || !groupId || !startDate || !endDate) {
    return new Response(null, { status: 302, headers: { Location: '/reservations/new?error=必須項目を入力してください' } });
  }
  if (startAt >= endAt) {
    return new Response(null, { status: 302, headers: { Location: '/reservations/new?error=終了日時は開始日時より後に設定してください' } });
  }

  // Check for overlapping approved reservations
  const hasOverlap = await checkOverlap(db, facilityId, startAt, endAt);
  if (hasOverlap) {
    return new Response(null, { status: 302, headers: { Location: '/reservations/new?error=指定の日時はすでに別の承認済み予約と重複しています' } });
  }

  const id  = crypto.randomUUID();
  const now = new Date().toISOString();

  // Staff creates directly as approved; groups create as provisional
  const status = user.is_staff ? 'approved' : 'provisional';

  await db.prepare(
    `INSERT INTO reservations
       (id, group_id, facility_id, start_at, end_at, headcount, note, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, groupId, facilityId, startAt, endAt,
    headcount ? parseInt(headcount, 10) : null,
    note || null,
    status,
    user.id, now, now,
  ).run();

  return new Response(null, { status: 302, headers: { Location: `/reservations/${id}?created=1` } });
}

// ── Reservation detail page ────────────────────────────────────────

export async function reservationDetail(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const reservation = await getReservationById(db, id);
  if (!reservation) return new Response('Not Found', { status: 404 });

  // Fetch related data
  const [facility, group, messages] = await Promise.all([
    import('./utils/db.ts').then(m => m.getFacilityById(db, reservation.facility_id)),
    import('./utils/db.ts').then(m => m.getGroupById(db, reservation.group_id)),
    getMessages(db, id),
  ]);

  // Check access: staff or member of the group
  let userRole: 'owner' | 'member' | null = null;
  if (!user.is_staff) {
    userRole = await import('./utils/db.ts').then(m =>
      m.getUserRoleInGroup(db, user.id, reservation.group_id),
    );
    if (!userRole) return new Response('Forbidden', { status: 403 });
  }

  const canWithdraw   = reservation.status === 'provisional' && (user.is_staff || userRole);
  const canCancel     = reservation.status === 'approved' && !user.is_staff;
  const canApprove    = reservation.status === 'provisional' && user.is_staff;
  const canReject     = reservation.status === 'provisional' && user.is_staff;
  const canStaffCancel= reservation.status === 'approved'   && user.is_staff;
  const canEdit       = reservation.status === 'provisional';

  const isActive = ['provisional', 'approved'].includes(reservation.status);

  const created = ctx.url.searchParams.get('created') === '1';
  const msgSent = ctx.url.searchParams.get('msg') === '1';

  // Simulated email notification events
  const emailEvents: string[] = [];
  if (created && !user.is_staff) emailEvents.push('申請者・団体オーナー・事務局に仮予約申請の通知メールを送信しました。');
  if (created && user.is_staff)  emailEvents.push('直接予約を作成しました（メール通知なし）。');
  if (msgSent) emailEvents.push('メッセージ通知メールを送信しました。');

  return render(
    <AppShell title="予約詳細" user={user}>
      <PageHeader
        title="予約詳細"
        action={
          <a href="/reservations" class="btn btn-outline btn-sm">← 一覧に戻る</a>
        }
      />

      {emailEvents.map(msg => (
        <div class="email-toast">
          <strong>📧 メール送信（デモ）</strong>
          {msg}
        </div>
      ))}

      {/* Status */}
      <div class="flex-center gap-12 mb-24">
        <span class={`badge badge-${reservation.status}`} style="font-size:.95rem;padding:6px 14px">
          {statusLabel(reservation.status)}
        </span>
        {reservation.status_reason ? (
          <span class="text-sm text-muted">理由：{reservation.status_reason}</span>
        ) : null}
      </div>

      {/* Reservation details */}
      <div class="card mb-24">
        <div class="card-header">
          <span class="card-title">予約情報</span>
        </div>
        <div class="card-body">
          <dl class="reservation-meta">
            <div>
              <dt>施設・設備</dt>
              <dd>{facility?.name ?? reservation.facility_id}</dd>
            </div>
            <div>
              <dt>申請団体</dt>
              <dd>{group?.name ?? reservation.group_id}</dd>
            </div>
            <div>
              <dt>開始日時</dt>
              <dd>{formatDateTime(reservation.start_at)}</dd>
            </div>
            <div>
              <dt>終了日時</dt>
              <dd>{formatDateTime(reservation.end_at)}</dd>
            </div>
            {reservation.headcount ? (
              <div>
                <dt>使用人数</dt>
                <dd>{reservation.headcount} 名</dd>
              </div>
            ) : null}
            {reservation.note ? (
              <div>
                <dt>備考</dt>
                <dd>{reservation.note}</dd>
              </div>
            ) : null}
            <div>
              <dt>申請日</dt>
              <dd>{formatDate(reservation.created_at)}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Actions */}
      {isActive ? (
        <div class="card mb-24">
          <div class="card-header"><span class="card-title">アクション</span></div>
          <div class="card-body flex-center gap-8" style="flex-wrap:wrap">

            {canApprove ? (
              <form method="post" action={`/reservations/${id}/approve`}
                onsubmit="return confirm('この予約を承認しますか？')">
                <button type="submit" class="btn btn-success">✓ 承認する</button>
              </form>
            ) : null}

            {canReject ? (
              <details>
                <summary class="btn btn-danger">✗ 却下する</summary>
                <form method="post" action={`/reservations/${id}/reject`}
                  style="margin-top:12px;padding:12px;border:1px solid var(--color-border);border-radius:6px">
                  <div class="form-group">
                    <label class="form-label" for="reject-reason">却下理由 *</label>
                    <textarea id="reject-reason" name="reason" class="form-textarea" required
                      placeholder="却下理由を入力してください"></textarea>
                  </div>
                  <button type="submit" class="btn btn-danger">却下する</button>
                </form>
              </details>
            ) : null}

            {canWithdraw ? (
              <form method="post" action={`/reservations/${id}/withdraw`}
                onsubmit="return confirm('この仮予約を取り消しますか？')">
                <button type="submit" class="btn btn-outline">取り消す</button>
              </form>
            ) : null}

            {canCancel ? (
              <form method="post" action={`/reservations/${id}/cancel`}
                onsubmit="return confirm('この予約をキャンセルしますか？')">
                <button type="submit" class="btn btn-danger">キャンセルする</button>
              </form>
            ) : null}

            {canStaffCancel ? (
              <details>
                <summary class="btn btn-danger">事務局キャンセル</summary>
                <form method="post" action={`/reservations/${id}/staff-cancel`}
                  style="margin-top:12px;padding:12px;border:1px solid var(--color-border);border-radius:6px">
                  <div class="form-group">
                    <label class="form-label" for="cancel-reason">キャンセル理由 *</label>
                    <textarea id="cancel-reason" name="reason" class="form-textarea" required
                      placeholder="キャンセル理由を入力してください"></textarea>
                  </div>
                  <button type="submit" class="btn btn-danger">キャンセルする</button>
                </form>
              </details>
            ) : null}

            {canEdit ? (
              <a href={`/reservations/${id}/edit`} class="btn btn-outline">✎ 編集</a>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Messages */}
      <div class="card">
        <div class="card-header"><span class="card-title">メッセージ</span></div>
        <div class="card-body">
          {messages.length === 0 ? (
            <p class="text-muted text-sm">まだメッセージはありません。</p>
          ) : (
            <div class="msg-list mb-16">
              {messages.map(m => {
                const fromMe = m.sender_id === user.id;
                return (
                  <div>
                    <div class={`msg-bubble ${fromMe ? 'from-me' : 'from-other'}`}>
                      {m.body}
                    </div>
                    <div class={`msg-meta ${fromMe ? 'text-right' : ''}`}
                      style={fromMe ? 'text-align:right' : ''}>
                      {m.sender_name}
                      {m.sender_is_staff ? ' (事務局)' : ''}
                      &nbsp;·&nbsp;
                      {formatDateTime(m.sent_at)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Message send form */}
          <form method="post" action={`/reservations/${id}/messages`} class="msg-send">
            <textarea name="body" class="form-textarea"
              placeholder="メッセージを入力…"
              style="min-height:72px"
              required></textarea>
            <button type="submit" class="btn btn-primary" style="align-self:flex-end">送信</button>
          </form>
        </div>
      </div>
    </AppShell>,
  );
}

// ── Edit reservation page ──────────────────────────────────────────

export async function editReservationPage(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const reservation = await getReservationById(db, id);
  if (!reservation) return new Response('Not Found', { status: 404 });
  if (reservation.status !== 'provisional') return new Response(null, { status: 302, headers: { Location: `/reservations/${id}` } });

  const [facilities, groups] = await Promise.all([
    getAllFacilities(db, true),
    user.is_staff
      ? import('./utils/db.ts').then(m => m.getAllGroups(db))
      : import('./utils/db.ts').then(m => m.getGroupsForUser(db, user.id)),
  ]);

  const startDt = new Date(reservation.start_at);
  const endDt   = new Date(reservation.end_at);
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const startDate = `${startDt.getUTCFullYear()}-${pad2(startDt.getUTCMonth()+1)}-${pad2(startDt.getUTCDate())}`;
  const startTime = `${pad2(startDt.getUTCHours())}:${pad2(startDt.getUTCMinutes())}`;
  const endDate   = `${endDt.getUTCFullYear()}-${pad2(endDt.getUTCMonth()+1)}-${pad2(endDt.getUTCDate())}`;
  const endTime   = `${pad2(endDt.getUTCHours())}:${pad2(endDt.getUTCMinutes())}`;

  return render(
    <AppShell title="予約編集" user={user}>
      <PageHeader title="予約編集"
        action={<a href={`/reservations/${id}`} class="btn btn-outline btn-sm">← 詳細に戻る</a>} />

      <div class="card" style="max-width:600px">
        <div class="card-body">
          <form method="post" action={`/reservations/${id}/edit`}>
            <div class="form-group">
              <label class="form-label" for="facility_id">施設・設備 *</label>
              <select id="facility_id" name="facility_id" class="form-select" required>
                {facilities.map(f => (
                  <option value={f.id} selected={reservation.facility_id === f.id}>{f.name}</option>
                ))}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="group_id">団体 *</label>
              <select id="group_id" name="group_id" class="form-select" required>
                {groups.map(g => (
                  <option value={g.id} selected={reservation.group_id === g.id}>{g.name}</option>
                ))}
              </select>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">開始日</label>
                <input name="start_date" type="date" class="form-input" value={startDate} required />
              </div>
              <div class="form-group">
                <label class="form-label">開始時刻</label>
                <input name="start_time" type="time" class="form-input" value={startTime} required />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">終了日</label>
                <input name="end_date" type="date" class="form-input" value={endDate} required />
              </div>
              <div class="form-group">
                <label class="form-label">終了時刻</label>
                <input name="end_time" type="time" class="form-input" value={endTime} required />
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">使用人数</label>
              <input name="headcount" type="number" class="form-input" min="1"
                value={reservation.headcount ?? ''} />
            </div>
            <div class="form-group">
              <label class="form-label">備考</label>
              <textarea name="note" class="form-textarea">{reservation.note ?? ''}</textarea>
            </div>
            <div class="flex-center gap-8 mt-16">
              <button type="submit" class="btn btn-primary">保存する</button>
              <a href={`/reservations/${id}`} class="btn btn-outline">キャンセル</a>
            </div>
          </form>
        </div>
      </div>
    </AppShell>,
  );
}

// ── Edit reservation action ────────────────────────────────────────

export async function editReservationAction(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const reservation = await getReservationById(db, id);
  if (!reservation || reservation.status !== 'provisional') {
    return new Response(null, { status: 302, headers: { Location: `/reservations/${id}` } });
  }

  const data       = ctx.formData;
  const facilityId = data.get('facility_id') as string;
  const groupId    = data.get('group_id')    as string;
  const startAt    = `${data.get('start_date')}T${data.get('start_time')}:00Z`;
  const endAt      = `${data.get('end_date')}T${data.get('end_time')}:00Z`;
  const headcount  = data.get('headcount') as string;
  const note       = data.get('note')      as string;
  const now        = new Date().toISOString();

  await db.prepare(
    `UPDATE reservations
     SET facility_id=?, group_id=?, start_at=?, end_at=?, headcount=?, note=?, updated_at=?
     WHERE id=?`,
  ).bind(
    facilityId, groupId, startAt, endAt,
    headcount ? parseInt(headcount, 10) : null,
    note || null, now, id,
  ).run();

  return new Response(null, { status: 302, headers: { Location: `/reservations/${id}` } });
}

// ── Status change actions ──────────────────────────────────────────

async function emailToast(reason: string): Promise<string> { return reason; }

export async function approveReservation(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  if (!user.is_staff) return new Response('Forbidden', { status: 403 });
  const { id } = ctx.params as { id: string };

  const reservation = await getReservationById(db, id);
  if (!reservation || reservation.status !== 'provisional') {
    return new Response(null, { status: 302, headers: { Location: `/reservations/${id}` } });
  }

  // Check overlap again at approval time
  const hasOverlap = await checkOverlap(db, reservation.facility_id, reservation.start_at, reservation.end_at, id);
  if (hasOverlap) {
    return new Response(null, { status: 302, headers: { Location: `/reservations/${id}?error=overlap` } });
  }

  await db.prepare(
    "UPDATE reservations SET status='approved', updated_at=? WHERE id=?",
  ).bind(new Date().toISOString(), id).run();

  // (Email notification would be sent here)
  return new Response(null, { status: 302, headers: { Location: `/reservations/${id}?approved=1` } });
}

export async function rejectReservation(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  if (!user.is_staff) return new Response('Forbidden', { status: 403 });
  const { id } = ctx.params as { id: string };

  const data   = ctx.formData;
  const reason = (data.get('reason') as string)?.trim();
  if (!reason) return new Response(null, { status: 302, headers: { Location: `/reservations/${id}?error=reason_required` } });

  await db.prepare(
    "UPDATE reservations SET status='rejected', status_reason=?, updated_at=? WHERE id=?",
  ).bind(reason, new Date().toISOString(), id).run();

  return new Response(null, { status: 302, headers: { Location: `/reservations/${id}?rejected=1` } });
}

export async function withdrawReservation(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const reservation = await getReservationById(db, id);
  if (!reservation || reservation.status !== 'provisional') {
    return new Response(null, { status: 302, headers: { Location: `/reservations/${id}` } });
  }

  await db.prepare(
    "UPDATE reservations SET status='withdrawn', updated_at=? WHERE id=?",
  ).bind(new Date().toISOString(), id).run();

  return new Response(null, { status: 302, headers: { Location: `/reservations/${id}?withdrawn=1` } });
}

export async function cancelReservation(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const reservation = await getReservationById(db, id);
  if (!reservation || reservation.status !== 'approved') {
    return new Response(null, { status: 302, headers: { Location: `/reservations/${id}` } });
  }

  await db.prepare(
    "UPDATE reservations SET status='cancelled', updated_at=? WHERE id=?",
  ).bind(new Date().toISOString(), id).run();

  return new Response(null, { status: 302, headers: { Location: `/reservations/${id}?cancelled=1` } });
}

export async function staffCancelReservation(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  if (!user.is_staff) return new Response('Forbidden', { status: 403 });
  const { id } = ctx.params as { id: string };

  const data   = ctx.formData;
  const reason = (data.get('reason') as string)?.trim();
  if (!reason) return new Response(null, { status: 302, headers: { Location: `/reservations/${id}?error=reason_required` } });

  await db.prepare(
    "UPDATE reservations SET status='cancelled_by_staff', status_reason=?, updated_at=? WHERE id=?",
  ).bind(reason, new Date().toISOString(), id).run();

  return new Response(null, { status: 302, headers: { Location: `/reservations/${id}?cancelled=1` } });
}

// ── Send message action ────────────────────────────────────────────

export async function sendMessage(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const data = ctx.formData;
  const body = (data.get('body') as string)?.trim();
  if (!body) return new Response(null, { status: 302, headers: { Location: `/reservations/${id}` } });

  const msgId = crypto.randomUUID();
  const now   = new Date().toISOString();

  await db.prepare(
    'INSERT INTO messages (id, reservation_id, sender_id, body, sent_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(msgId, id, user.id, body, now).run();

  // (Email notification would be sent here)
  return new Response(null, { status: 302, headers: { Location: `/reservations/${id}?msg=1` } });
}
