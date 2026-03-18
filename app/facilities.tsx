import type { RequestContext } from 'remix/fetch-router';
import { render } from './utils/render.tsx';
import { AppShell, PageHeader } from './layout.tsx';
import { currentUserKey, dbKey } from './utils/context.ts';
import { getAllFacilities, getFacilityById } from './utils/db.ts';

// ── Facility list (staff only) ────────────────────────────────────

export async function facilityList(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;

  const facilities = await getAllFacilities(db);
  const msgParam   = ctx.url.searchParams.get('msg');

  return render(
    <AppShell title="施設管理" user={user}>
      <PageHeader
        title="施設・設備管理"
        subtitle="施設・設備の登録・編集・有効化/無効化"
        action={
          <button type="button" class="btn btn-primary"
            onclick="document.getElementById('new-facility-form').style.display='block';this.style.display='none'">
            ＋ 新規登録
          </button>
        }
      />

      {msgParam === 'created' ? <div class="alert alert-success">施設・設備を登録しました。</div> : null}
      {msgParam === 'updated' ? <div class="alert alert-success">施設・設備の情報を更新しました。</div> : null}
      {msgParam === 'toggled' ? <div class="alert alert-success">ステータスを変更しました。</div> : null}

      {/* New facility form (hidden by default) */}
      <div id="new-facility-form" style="display:none" class="card mb-24">
        <div class="card-header"><span class="card-title">新規施設・設備登録</span></div>
        <div class="card-body">
          <form method="post" action="/facilities" style="max-width:600px">
            <div class="form-group">
              <label class="form-label" for="new-name">名称 *</label>
              <input id="new-name" name="name" type="text" class="form-input"
                placeholder="例: 吹田：新設備名" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="new-desc">説明</label>
              <textarea id="new-desc" name="description" class="form-textarea"
                placeholder="施設・設備の説明"></textarea>
            </div>
            <div class="flex-center gap-8 mt-16">
              <button type="submit" class="btn btn-primary">登録する</button>
              <button type="button" class="btn btn-outline"
                onclick="document.getElementById('new-facility-form').style.display='none';document.querySelector('[onclick*=new-facility]').style.display='inline-flex'">
                キャンセル
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Facilities list */}
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>説明</th>
                <th>ステータス</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {facilities.map(f => (
                <tr>
                  <td><strong>{f.name}</strong></td>
                  <td class="text-muted" style="max-width:240px">
                    {f.description ? f.description.slice(0, 60) + (f.description.length > 60 ? '…' : '') : '—'}
                  </td>
                  <td>
                    <span class={`badge ${f.is_active ? 'badge-active' : 'badge-inactive'}`}>
                      {f.is_active ? '有効' : '無効'}
                    </span>
                  </td>
                  <td class="flex-center gap-8">
                    <a href={`/facilities/${f.id}/edit`} class="btn btn-outline btn-sm">編集</a>
                    <form method="post" action={`/facilities/${f.id}/toggle`}>
                      <button type="submit" class="btn btn-ghost btn-sm">
                        {f.is_active ? '無効化' : '有効化'}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>,
  );
}

// ── Create facility action ────────────────────────────────────────

export async function createFacility(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  if (!user.is_staff) return new Response('Forbidden', { status: 403 });

  const db   = ctx.storage.get(dbKey)!;
  const data = ctx.formData;
  const name = (data.get('name') as string)?.trim();
  const desc = (data.get('description') as string)?.trim();
  if (!name) return new Response(null, { status: 302, headers: { Location: '/facilities' } });

  const id  = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(
    'INSERT INTO facilities (id, name, description, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
  ).bind(id, name, desc || null, now, now).run();

  return new Response(null, { status: 302, headers: { Location: '/facilities?msg=created' } });
}

// ── Edit facility page ────────────────────────────────────────────

export async function editFacilityPage(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const facility = await getFacilityById(db, id);
  if (!facility) return new Response('Not Found', { status: 404 });

  return render(
    <AppShell title="施設編集" user={user}>
      <PageHeader title="施設・設備の編集"
        action={<a href="/facilities" class="btn btn-outline btn-sm">← 一覧に戻る</a>} />

      <div class="card" style="max-width:600px">
        <div class="card-body">
          <form method="post" action={`/facilities/${id}/update`}>
            <div class="form-group">
              <label class="form-label" for="name">名称 *</label>
              <input id="name" name="name" type="text" class="form-input"
                value={facility.name} required />
            </div>
            <div class="form-group">
              <label class="form-label" for="description">説明</label>
              <textarea id="description" name="description" class="form-textarea">
                {facility.description ?? ''}
              </textarea>
            </div>
            <div class="flex-center gap-8 mt-16">
              <button type="submit" class="btn btn-primary">保存する</button>
              <a href="/facilities" class="btn btn-outline">キャンセル</a>
            </div>
          </form>
        </div>
      </div>
    </AppShell>,
  );
}

// ── Update facility action ────────────────────────────────────────

export async function updateFacility(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  if (!user.is_staff) return new Response('Forbidden', { status: 403 });

  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };
  const data = ctx.formData;
  const name = (data.get('name') as string)?.trim();
  const desc = (data.get('description') as string)?.trim();
  if (!name) return new Response(null, { status: 302, headers: { Location: '/facilities' } });

  await db.prepare(
    'UPDATE facilities SET name=?, description=?, updated_at=? WHERE id=?',
  ).bind(name, desc || null, new Date().toISOString(), id).run();

  return new Response(null, { status: 302, headers: { Location: '/facilities?msg=updated' } });
}

// ── Toggle facility active ────────────────────────────────────────

export async function toggleFacility(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  if (!user.is_staff) return new Response('Forbidden', { status: 403 });

  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  await db.prepare(
    'UPDATE facilities SET is_active = ((is_active + 1) % 2), updated_at = ? WHERE id = ?',
  ).bind(new Date().toISOString(), id).run();

  return new Response(null, { status: 302, headers: { Location: '/facilities?msg=toggled' } });
}
