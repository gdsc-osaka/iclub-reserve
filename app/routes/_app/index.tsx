import { data, Link } from "react-router";
import type { Route } from "./+types/index";
import { getDb } from "~/db/client";
import { facilities, reservations } from "~/db/schema";
import { requireAuth } from "~/lib/auth";
import { and, eq, gte } from "drizzle-orm";

export function meta() {
  return [{ title: "空き状況 | iclub-reserve" }];
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

  // 今日以降の承認済み予約を取得（カレンダー表示用）
  const today = new Date().toISOString().split("T")[0];
  const upcomingReservations = await db
    .select({
      id: reservations.id,
      facilityId: reservations.facilityId,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      status: reservations.status,
      groupId: reservations.groupId,
    })
    .from(reservations)
    .where(
      and(
        gte(reservations.startAt, today),
        eq(reservations.status, "approved"),
      ),
    )
    .all();

  return data({ session, facilityList, upcomingReservations });
}

export default function IndexPage({ loaderData }: Route.ComponentProps) {
  const { session, facilityList, upcomingReservations } = loaderData;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">空き状況カレンダー</h1>
        {!session.isStaff && (
          <Link
            to="/reservations/new"
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            予約を申請する
          </Link>
        )}
      </div>

      {facilityList.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          利用可能な施設・設備がありません。
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-100 text-sm text-gray-500">
            承認済みの予約を表示しています。予約申請には「予約を申請する」ボタンをご利用ください。
          </div>
          <div className="divide-y divide-gray-100">
            {facilityList.map((facility) => {
              const facilityReservations = upcomingReservations.filter(
                (r) => r.facilityId === facility.id,
              );
              return (
                <div key={facility.id} className="p-4">
                  <h2 className="font-medium text-gray-900 mb-2">
                    {facility.name}
                  </h2>
                  {facilityReservations.length === 0 ? (
                    <p className="text-sm text-gray-400">
                      直近の予約はありません
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {facilityReservations.slice(0, 5).map((r) => (
                        <div
                          key={r.id}
                          className="text-sm text-gray-600 flex gap-2"
                        >
                          <span className="text-gray-400">
                            {new Date(r.startAt).toLocaleDateString("ja-JP", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          <span>
                            {new Date(r.startAt).toLocaleTimeString("ja-JP", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {" 〜 "}
                            {new Date(r.endAt).toLocaleTimeString("ja-JP", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          <span className="bg-green-100 text-green-700 text-xs px-1.5 py-0.5 rounded">
                            承認済み
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
