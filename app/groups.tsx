import type { RequestContext } from 'remix/fetch-router';
import { render } from './utils/render.tsx';
import { AppShell, PageHeader } from './layout.tsx';
import { currentUserKey, dbKey } from './utils/context.ts';
import {
  getAllGroups, getGroupById, getGroupsForUser, getMemberships, getUserRoleInGroup,
} from './utils/db.ts';

// ── Group list ────────────────────────────────────────────────────

export async function groupList(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;

  const groups = user.is_staff
    ? await getAllGroups(db)
    : await getGroupsForUser(db, user.id);

  return render(
    <AppShell title="団体一覧" user={user}>
      <PageHeader
        title="団体一覧"
        action={
          <a href="/groups/new" class="btn btn-primary">＋ 団体を作成</a>
        }
      />

      {groups.length === 0 ? (
        <div class="empty-state">
          <p>団体がありません。</p>
          <a href="/groups/new" class="btn btn-primary" style="margin-top:16px">団体を作成する</a>
        </div>
      ) : (
        <div class="card">
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>団体名</th>
                  {user.is_staff ? null : <th>あなたの役割</th>}
                  <th>ステータス</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g: any) => (
                  <tr>
                    <td><strong>{g.name}</strong></td>
                    {user.is_staff ? null : (
                      <td>
                        <span class={`badge badge-${g.role}`}>
                          {g.role === 'owner' ? 'オーナー' : 'メンバー'}
                        </span>
                      </td>
                    )}
                    <td>
                      <span class={`badge ${g.is_active ? 'badge-active' : 'badge-inactive'}`}>
                        {g.is_active ? '有効' : '無効'}
                      </span>
                    </td>
                    <td>
                      <a href={`/groups/${g.id}`} class="btn btn-outline btn-sm">管理</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>,
  );
}

// ── New group form ─────────────────────────────────────────────────

export async function newGroupPage(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const errorMsg = ctx.url.searchParams.get('error');

  return render(
    <AppShell title="団体作成" user={user}>
      <PageHeader title="団体を作成" />

      {errorMsg ? <div class="alert alert-error">{errorMsg}</div> : null}

      <div class="card" style="max-width:480px">
        <div class="card-body">
          <form method="post" action="/groups">
            <div class="form-group">
              <label class="form-label" for="name">団体名 *</label>
              <input id="name" name="name" type="text" class="form-input"
                placeholder="例: Robotics Club" required />
              <div class="form-hint">あなたが初期オーナーになります。</div>
            </div>
            <div class="flex-center gap-8 mt-16">
              <button type="submit" class="btn btn-primary">作成する</button>
              <a href="/groups" class="btn btn-outline">キャンセル</a>
            </div>
          </form>
        </div>
      </div>
    </AppShell>,
  );
}

// ── Create group action ────────────────────────────────────────────

export async function createGroup(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;

  const data = ctx.formData;
  const name = (data.get('name') as string)?.trim();
  if (!name) return new Response(null, { status: 302, headers: { Location: '/groups/new?error=団体名を入力してください' } });

  const id  = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.batch([
    db.prepare(
      'INSERT INTO groups (id, name, is_active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
    ).bind(id, name, now, now),
    db.prepare(
      'INSERT INTO memberships (id, user_id, group_id, role, joined_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), user.id, id, 'owner', now),
  ]);

  return new Response(null, { status: 302, headers: { Location: `/groups/${id}` } });
}

// ── Group detail / management ──────────────────────────────────────

export async function groupDetail(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const group = await getGroupById(db, id);
  if (!group) return new Response('Not Found', { status: 404 });

  // Access control: staff or member of this group
  const userRole = user.is_staff ? 'owner' : await getUserRoleInGroup(db, user.id, id);
  if (!userRole) return new Response('Forbidden', { status: 403 });

  const members  = await getMemberships(db, id);
  const canManage = user.is_staff || userRole === 'owner';

  const msgParam = ctx.url.searchParams.get('msg');

  return render(
    <AppShell title={`${group.name} — 団体管理`} user={user}>
      <PageHeader
        title={group.name}
        action={<a href="/groups" class="btn btn-outline btn-sm">← 一覧に戻る</a>}
      />

      {msgParam === 'added'   ? <div class="alert alert-success">メンバーを追加しました。</div> : null}
      {msgParam === 'removed' ? <div class="alert alert-success">メンバーを削除しました。</div> : null}
      {msgParam === 'toggled' ? <div class="alert alert-success">ステータスを変更しました。</div> : null}

      {/* Group info */}
      <div class="flex-center gap-12 mb-24">
        <span class={`badge ${group.is_active ? 'badge-active' : 'badge-inactive'}`}>
          {group.is_active ? '有効' : '無効'}
        </span>
        {user.is_staff ? (
          <form method="post" action={`/groups/${id}/toggle`}>
            <button type="submit" class="btn btn-outline btn-sm">
              {group.is_active ? '無効化' : '有効化'}
            </button>
          </form>
        ) : null}
      </div>

      {/* Group name edit (owner or staff) */}
      {canManage ? (
        <div class="card mb-24">
          <div class="card-header"><span class="card-title">団体情報の編集</span></div>
          <div class="card-body">
            <form method="post" action={`/groups/${id}/rename`} class="flex-center gap-8">
              <input name="name" type="text" class="form-input" value={group.name}
                style="max-width:300px" required />
              <button type="submit" class="btn btn-primary btn-sm">保存</button>
            </form>
          </div>
        </div>
      ) : null}

      {/* Members */}
      <div class="card mb-24">
        <div class="card-header">
          <span class="card-title">メンバー</span>
          <span class="text-muted text-sm">{members.length}名</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名前</th>
                <th>メールアドレス</th>
                <th>役割</th>
                {canManage ? <th>操作</th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr>
                  <td>{m.user_name}</td>
                  <td class="text-muted">{m.user_email}</td>
                  <td>
                    <span class={`badge badge-${m.role}`}>
                      {m.role === 'owner' ? 'オーナー' : 'メンバー'}
                    </span>
                  </td>
                  {canManage ? (
                    <td class="flex-center gap-8">
                      <form method="post" action={`/groups/${id}/role`}>
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <input type="hidden" name="role"
                          value={m.role === 'owner' ? 'member' : 'owner'} />
                        <button type="submit" class="btn btn-ghost btn-sm">
                          {m.role === 'owner' ? 'メンバーに降格' : 'オーナーに昇格'}
                        </button>
                      </form>
                      {m.user_id !== user.id ? (
                        <form method="post" action={`/groups/${id}/members/remove`}
                          onsubmit="return confirm('このメンバーを削除しますか？')">
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <button type="submit" class="btn btn-danger btn-sm">削除</button>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add member */}
        {canManage ? (
          <div class="card-body" style="border-top:1px solid var(--color-border)">
            <p class="text-sm text-muted mb-16">
              ※デモでは事前登録済みのメールアドレスのみ追加できます。
            </p>
            <form method="post" action={`/groups/${id}/members`} class="flex-center gap-8">
              <input name="email" type="email" class="form-input"
                placeholder="追加するユーザーのメールアドレス" required
                style="max-width:300px" />
              <button type="submit" class="btn btn-primary btn-sm">追加</button>
            </form>
          </div>
        ) : null}
      </div>
    </AppShell>,
  );
}

// ── Add member action ──────────────────────────────────────────────

export async function addMember(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const data  = ctx.formData;
  const email = (data.get('email') as string)?.trim().toLowerCase();
  if (!email) return new Response(null, { status: 302, headers: { Location: `/groups/${id}` } });

  const target = await db.prepare(
    'SELECT id FROM users WHERE email = ?',
  ).bind(email).first<{ id: string }>();

  if (!target) {
    return new Response(null, { status: 302, headers: { Location: `/groups/${id}?error=ユーザーが見つかりません` } });
  }

  const now = new Date().toISOString();
  await db.prepare(
    'INSERT OR IGNORE INTO memberships (id, user_id, group_id, role, joined_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(crypto.randomUUID(), target.id, id, 'member', now).run();

  return new Response(null, { status: 302, headers: { Location: `/groups/${id}?msg=added` } });
}

// ── Remove member action ───────────────────────────────────────────

export async function removeMember(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const data   = ctx.formData;
  const userId = data.get('user_id') as string;

  await db.prepare(
    'DELETE FROM memberships WHERE group_id = ? AND user_id = ?',
  ).bind(id, userId).run();

  return new Response(null, { status: 302, headers: { Location: `/groups/${id}?msg=removed` } });
}

// ── Change role action ─────────────────────────────────────────────

export async function changeRole(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const data   = ctx.formData;
  const userId = data.get('user_id') as string;
  const role   = data.get('role')    as string;

  if (role !== 'owner' && role !== 'member') {
    return new Response(null, { status: 302, headers: { Location: `/groups/${id}` } });
  }

  await db.prepare(
    'UPDATE memberships SET role = ? WHERE group_id = ? AND user_id = ?',
  ).bind(role, id, userId).run();

  return new Response(null, { status: 302, headers: { Location: `/groups/${id}` } });
}

// ── Rename group action ────────────────────────────────────────────

export async function renameGroup(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  const data = ctx.formData;
  const name = (data.get('name') as string)?.trim();
  if (!name) return new Response(null, { status: 302, headers: { Location: `/groups/${id}` } });

  await db.prepare(
    'UPDATE groups SET name = ?, updated_at = ? WHERE id = ?',
  ).bind(name, new Date().toISOString(), id).run();

  return new Response(null, { status: 302, headers: { Location: `/groups/${id}` } });
}

// ── Toggle group active action ─────────────────────────────────────

export async function toggleGroup(ctx: RequestContext): Promise<Response> {
  const user = ctx.storage.get(currentUserKey)!;
  if (!user.is_staff) return new Response('Forbidden', { status: 403 });

  const db   = ctx.storage.get(dbKey)!;
  const { id } = ctx.params as { id: string };

  await db.prepare(
    'UPDATE groups SET is_active = ((is_active + 1) % 2), updated_at = ? WHERE id = ?',
  ).bind(new Date().toISOString(), id).run();

  return new Response(null, { status: 302, headers: { Location: `/groups/${id}?msg=toggled` } });
}
