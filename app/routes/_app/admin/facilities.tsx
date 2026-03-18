import { data, Form } from "react-router";
import type { Route } from "./+types/facilities";
import { getDb } from "~/db/client";
import { facilities } from "~/db/schema";
import { requireStaff } from "~/lib/auth";
import { generateId } from "~/lib/id";
import { eq } from "drizzle-orm";

export function meta() {
  return [{ title: "施設管理 | iclub-reserve" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requireStaff(request, env);
  const db = getDb(env);

  const facilityList = await db.select().from(facilities).all();
  return data({ facilityList });
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  await requireStaff(request, env);
  const db = getDb(env);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "create") {
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const googleCalendarId =
      String(formData.get("googleCalendarId") ?? "").trim() || null;

    if (!name) return data({ error: "施設名を入力してください。" }, { status: 400 });

    const id = generateId();
    const calendarUrl = googleCalendarId
      ? `https://calendar.google.com/calendar/ical/${encodeURIComponent(googleCalendarId)}/public/basic.ics`
      : null;

    await db.insert(facilities).values({
      id,
      name,
      description,
      googleCalendarId,
      calendarUrl,
      isActive: true,
    });
    return data({ success: true });
  }

  if (intent === "update") {
    const id = String(formData.get("id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const googleCalendarId =
      String(formData.get("googleCalendarId") ?? "").trim() || null;

    if (!name) return data({ error: "施設名を入力してください。" }, { status: 400 });

    const calendarUrl = googleCalendarId
      ? `https://calendar.google.com/calendar/ical/${encodeURIComponent(googleCalendarId)}/public/basic.ics`
      : null;

    await db
      .update(facilities)
      .set({ name, description, googleCalendarId, calendarUrl, updatedAt: new Date().toISOString() })
      .where(eq(facilities.id, id));
    return data({ success: true });
  }

  if (intent === "disable") {
    const id = String(formData.get("id") ?? "");
    // TODO: COND-003 - 将来の予約がすべて終了状態であることを確認
    await db
      .update(facilities)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(facilities.id, id));
    return data({ success: true });
  }

  if (intent === "enable") {
    const id = String(formData.get("id") ?? "");
    await db
      .update(facilities)
      .set({ isActive: true, updatedAt: new Date().toISOString() })
      .where(eq(facilities.id, id));
    return data({ success: true });
  }

  return data({ error: "不正な操作です。" }, { status: 400 });
}

export default function AdminFacilitiesPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { facilityList } = loaderData;

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-6">施設・設備管理</h1>

      {actionData && "error" in actionData && actionData.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {actionData.error}
        </div>
      )}

      {/* 新規登録 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <h2 className="font-medium text-gray-900 mb-4">新規登録</h2>
        <Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="create" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                施設・設備名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: 吹田：C棟2階占有 イベント予約"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Google Calendar ID
              </label>
              <input
                type="text"
                name="googleCalendarId"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="例: xxxx@group.calendar.google.com"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              説明
            </label>
            <input
              type="text"
              name="description"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            登録する
          </button>
        </Form>
      </div>

      {/* 一覧 */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                施設・設備名
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                Google Calendar ID
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">
                状態
              </th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {facilityList.map((f) => (
              <tr key={f.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">
                  {f.name}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {f.googleCalendarId ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium ${
                      f.isActive
                        ? "bg-green-100 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {f.isActive ? "有効" : "無効"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Form method="post" className="inline">
                    <input type="hidden" name="id" value={f.id} />
                    <input
                      type="hidden"
                      name="intent"
                      value={f.isActive ? "disable" : "enable"}
                    />
                    <button
                      type="submit"
                      className="text-xs text-gray-500 hover:text-gray-700 hover:underline"
                      onClick={(e) => {
                        if (
                          f.isActive &&
                          !confirm(
                            "この施設を無効化しますか？将来の予約がすべて終了状態であることを確認してください。",
                          )
                        )
                          e.preventDefault();
                      }}
                    >
                      {f.isActive ? "無効化" : "有効化"}
                    </button>
                  </Form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
