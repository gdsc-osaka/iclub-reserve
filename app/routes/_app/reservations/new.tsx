import { data, Form, redirect } from "react-router";
import type { Route } from "./+types/new";
import { getDb } from "~/db/client";
import { facilities, groups, memberships, reservations } from "~/db/schema";
import { requireAuth } from "~/lib/auth";
import { generateId } from "~/lib/id";
import { and, eq, gt, inArray, lt } from "drizzle-orm";

export function meta() {
  return [{ title: "予約申請 | iclub-reserve" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const session = await requireAuth(request, env);
  const db = getDb(env);

  const facilityList = await db
    .select()
    .from(facilities)
    .where(eq(facilities.isActive, true))
    .all();

  // 所属団体一覧
  const myMemberships = await db
    .select({ groupId: memberships.groupId })
    .from(memberships)
    .where(eq(memberships.userId, session.userId))
    .all();

  const myGroupIds = myMemberships.map((m) => m.groupId);
  const myGroups =
    myGroupIds.length > 0
      ? await db
          .select()
          .from(groups)
          .where(and(inArray(groups.id, myGroupIds), eq(groups.isActive, true)))
          .all()
      : [];

  return data({ session, facilityList, myGroups });
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const session = await requireAuth(request, env);
  const db = getDb(env);
  const formData = await request.formData();

  const groupId = String(formData.get("groupId") ?? "");
  const facilityId = String(formData.get("facilityId") ?? "");
  const startAt = String(formData.get("startAt") ?? "");
  const endAt = String(formData.get("endAt") ?? "");
  const headcount = formData.get("headcount")
    ? Number(formData.get("headcount"))
    : null;
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!groupId || !facilityId || !startAt || !endAt) {
    return data({ error: "必須項目を入力してください。" }, { status: 400 });
  }

  if (new Date(startAt) >= new Date(endAt)) {
    return data(
      { error: "終了日時は開始日時より後に設定してください。" },
      { status: 400 },
    );
  }

  // 重複チェック（COND-001）: 同一施設・同一時間帯に承認済み予約が存在しないこと
  const conflicts = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.facilityId, facilityId),
        eq(reservations.status, "approved"),
        lt(reservations.startAt, endAt),
        gt(reservations.endAt, startAt),
      ),
    )
    .all();

  if (conflicts.length > 0) {
    return data(
      {
        error:
          "選択した時間帯は既に予約が入っています。別の時間帯を選択してください。",
      },
      { status: 400 },
    );
  }

  const id = generateId();
  await db.insert(reservations).values({
    id,
    groupId,
    facilityId,
    startAt,
    endAt,
    headcount,
    note,
    status: "provisional",
    createdBy: session.userId,
  });

  throw redirect(`/reservations/${id}`);
}

export default function NewReservationPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { facilityList, myGroups } = loaderData;

  if (myGroups.length === 0) {
    return (
      <div>
        <h1 className="text-xl font-bold mb-4">予約申請</h1>
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-gray-500 mb-4">
            予約を申請するには、いずれかの団体に所属している必要があります。
          </p>
          <a
            href="/groups/new"
            className="text-blue-600 hover:underline text-sm"
          >
            団体を作成する
          </a>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-6">予約申請</h1>

      {actionData?.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {actionData.error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-6 max-w-xl">
        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              団体 <span className="text-red-500">*</span>
            </label>
            <select
              name="groupId"
              required
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">選択してください</option>
              {myGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              施設・設備 <span className="text-red-500">*</span>
            </label>
            <select
              name="facilityId"
              required
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">選択してください</option>
              {facilityList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                開始日時 <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                name="startAt"
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                終了日時 <span className="text-red-500">*</span>
              </label>
              <input
                type="datetime-local"
                name="endAt"
                required
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              使用人数
            </label>
            <input
              type="number"
              name="headcount"
              min={1}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="例: 5"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              備考
            </label>
            <textarea
              name="note"
              rows={3}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="利用目的など"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="bg-blue-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              仮予約を申請する
            </button>
            <a
              href="/reservations"
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
