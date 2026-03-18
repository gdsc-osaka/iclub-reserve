import { data, Form, redirect } from "react-router";
import type { Route } from "./+types/new";
import { getDb } from "~/db/client";
import { groups, memberships } from "~/db/schema";
import { requireAuth } from "~/lib/auth";
import { generateId } from "~/lib/id";

export function meta() {
  return [{ title: "団体作成 | iclub-reserve" }];
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const session = await requireAuth(request, env);
  const db = getDb(env);
  const formData = await request.formData();
  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    return data({ error: "団体名を入力してください。" }, { status: 400 });
  }

  const groupId = generateId();
  const membershipId = generateId();

  await db.insert(groups).values({ id: groupId, name, isActive: true });
  await db.insert(memberships).values({
    id: membershipId,
    userId: session.userId,
    groupId,
    role: "owner",
  });

  throw redirect(`/groups/${groupId}`);
}

export default function NewGroupPage({ actionData }: Route.ComponentProps) {
  return (
    <div>
      <h1 className="text-xl font-bold mb-6">団体を作成する</h1>

      {actionData?.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {actionData.error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-md">
        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              団体名 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              name="name"
              required
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例: ロボット研究会"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="bg-blue-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              作成する
            </button>
            <a
              href="/groups"
              className="px-6 py-2 rounded text-sm text-gray-600 border border-gray-300 hover:bg-gray-50 transition-colors"
            >
              キャンセル
            </a>
          </div>
        </Form>
      </div>
    </div>
  );
}
