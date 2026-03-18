import { data, Form } from "react-router";
import type { Route } from "./+types/$id";
import { getDb } from "~/db/client";
import { groups, memberships, users } from "~/db/schema";
import { requireAuth } from "~/lib/auth";
import { generateId } from "~/lib/id";
import { and, eq } from "drizzle-orm";

export function meta() {
  return [{ title: "団体管理 | iclub-reserve" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const session = await requireAuth(request, env);
  const db = getDb(env);

  const group = await db
    .select()
    .from(groups)
    .where(eq(groups.id, params.id))
    .get();

  if (!group) throw new Response("Not Found", { status: 404 });

  const memberList = await db
    .select({
      membershipId: memberships.id,
      userId: users.id,
      userName: users.name,
      userEmail: users.email,
      role: memberships.role,
    })
    .from(memberships)
    .leftJoin(users, eq(memberships.userId, users.id))
    .where(eq(memberships.groupId, params.id))
    .all();

  const myMembership = memberList.find((m) => m.userId === session.userId);
  const canManage = session.isStaff || myMembership?.role === "owner";

  if (!canManage && !myMembership) {
    throw new Response("Forbidden", { status: 403 });
  }

  return data({ session, group, memberList, canManage });
}

export async function action({
  request,
  params,
  context,
}: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const session = await requireAuth(request, env);
  const db = getDb(env);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const group = await db
    .select()
    .from(groups)
    .where(eq(groups.id, params.id))
    .get();
  if (!group) throw new Response("Not Found", { status: 404 });

  const myMembership = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.groupId, params.id),
        eq(memberships.userId, session.userId),
      ),
    )
    .get();

  const canManage = session.isStaff || myMembership?.role === "owner";
  if (!canManage) throw new Response("Forbidden", { status: 403 });

  if (intent === "rename") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return data({ error: "団体名を入力してください。" }, { status: 400 });
    await db
      .update(groups)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(eq(groups.id, params.id));
    return data({ success: true });
  }

  if (intent === "add_member") {
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!email) return data({ error: "メールアドレスを入力してください。" }, { status: 400 });

    const targetUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .get();

    if (!targetUser) {
      return data(
        { error: "そのメールアドレスのユーザーは見つかりません。" },
        { status: 404 },
      );
    }

    const existing = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, targetUser.id),
          eq(memberships.groupId, params.id),
        ),
      )
      .get();

    if (existing) {
      return data(
        { error: "そのユーザーはすでにメンバーです。" },
        { status: 400 },
      );
    }

    await db.insert(memberships).values({
      id: generateId(),
      userId: targetUser.id,
      groupId: params.id,
      role: "member",
    });
    return data({ success: true });
  }

  if (intent === "change_role") {
    const membershipId = String(formData.get("membershipId") ?? "");
    const role = String(formData.get("role") ?? "") as "owner" | "member";
    await db
      .update(memberships)
      .set({ role })
      .where(eq(memberships.id, membershipId));
    return data({ success: true });
  }

  if (intent === "remove_member") {
    const membershipId = String(formData.get("membershipId") ?? "");
    await db
      .delete(memberships)
      .where(eq(memberships.id, membershipId));
    return data({ success: true });
  }

  if (intent === "disable" && session.isStaff) {
    await db
      .update(groups)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(groups.id, params.id));
    return data({ success: true });
  }

  return data({ error: "不正な操作です。" }, { status: 400 });
}

export default function GroupDetailPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { session, group, memberList, canManage } = loaderData;

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <a href="/groups" className="text-gray-400 hover:text-gray-600 text-sm">
          ← 団体一覧
        </a>
        <h1 className="text-xl font-bold text-gray-900">{group.name}</h1>
        {!group.isActive && (
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
            無効
          </span>
        )}
      </div>

      {actionData && "error" in actionData && actionData.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {actionData.error}
        </div>
      )}

      {/* 団体名変更 */}
      {canManage && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
          <h2 className="font-medium text-gray-900 mb-3">団体情報</h2>
          <Form method="post" className="flex gap-2">
            <input type="hidden" name="intent" value="rename" />
            <input
              type="text"
              name="name"
              defaultValue={group.name}
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <button
              type="submit"
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              保存
            </button>
          </Form>
        </div>
      )}

      {/* メンバー一覧 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
        <h2 className="font-medium text-gray-900 mb-3">メンバー</h2>
        <div className="divide-y divide-gray-100">
          {memberList.map((m) => (
            <div
              key={m.membershipId}
              className="py-2 flex items-center justify-between"
            >
              <div>
                <p className="text-sm font-medium text-gray-900">{m.userName}</p>
                <p className="text-xs text-gray-500">{m.userEmail}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    m.role === "owner"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {m.role === "owner" ? "オーナー" : "メンバー"}
                </span>
                {canManage && m.userId !== session.userId && (
                  <>
                    <Form method="post">
                      <input type="hidden" name="intent" value="change_role" />
                      <input type="hidden" name="membershipId" value={m.membershipId ?? ""} />
                      <input
                        type="hidden"
                        name="role"
                        value={m.role === "owner" ? "member" : "owner"}
                      />
                      <button
                        type="submit"
                        className="text-xs text-blue-600 hover:underline"
                      >
                        {m.role === "owner" ? "降格" : "昇格"}
                      </button>
                    </Form>
                    <Form method="post">
                      <input type="hidden" name="intent" value="remove_member" />
                      <input type="hidden" name="membershipId" value={m.membershipId ?? ""} />
                      <button
                        type="submit"
                        className="text-xs text-red-500 hover:underline"
                        onClick={(e) => {
                          if (!confirm("このメンバーを削除しますか？"))
                            e.preventDefault();
                        }}
                      >
                        削除
                      </button>
                    </Form>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* メンバー追加 */}
        {canManage && (
          <Form method="post" className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
            <input type="hidden" name="intent" value="add_member" />
            <input
              type="email"
              name="email"
              placeholder="メールアドレスでメンバーを追加"
              className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="bg-gray-900 text-white px-4 py-2 rounded text-sm font-medium hover:bg-gray-700 transition-colors whitespace-nowrap"
            >
              追加
            </button>
          </Form>
        )}
      </div>

      {/* 事務局操作 */}
      {session.isStaff && group.isActive && (
        <div className="bg-white rounded-lg border border-red-200 p-6">
          <h2 className="font-medium text-red-700 mb-3">管理者操作</h2>
          <Form method="post">
            <input type="hidden" name="intent" value="disable" />
            <button
              type="submit"
              className="text-sm text-red-600 border border-red-200 px-4 py-2 rounded hover:bg-red-50 transition-colors"
              onClick={(e) => {
                if (!confirm("この団体を無効化しますか？")) e.preventDefault();
              }}
            >
              団体を無効化する
            </button>
          </Form>
        </div>
      )}
    </div>
  );
}
