import { data, Link } from "react-router";
import type { Route } from "./+types/index";
import { getDb } from "~/db/client";
import { facilities, groups, memberships, reservations } from "~/db/schema";
import { requireAuth } from "~/lib/auth";
import { and, desc, eq, inArray } from "drizzle-orm";

export function meta() {
  return [{ title: "予約一覧 | iclub-reserve" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const session = await requireAuth(request, env);
  const db = getDb(env);

  let reservationList: Array<{
    id: string;
    startAt: string;
    endAt: string;
    status: string;
    headcount: number | null;
    facilityName: string | null;
    groupName: string | null;
  }>;

  if (session.isStaff) {
    // 事務局: 全予約を取得
    reservationList = await db
      .select({
        id: reservations.id,
        startAt: reservations.startAt,
        endAt: reservations.endAt,
        status: reservations.status,
        headcount: reservations.headcount,
        facilityName: facilities.name,
        groupName: groups.name,
      })
      .from(reservations)
      .leftJoin(facilities, eq(reservations.facilityId, facilities.id))
      .leftJoin(groups, eq(reservations.groupId, groups.id))
      .orderBy(desc(reservations.createdAt))
      .all();
  } else {
    // 団体: 自分が所属する団体の予約のみ
    const myMemberships = await db
      .select({ groupId: memberships.groupId })
      .from(memberships)
      .where(eq(memberships.userId, session.userId))
      .all();

    const myGroupIds = myMemberships.map((m) => m.groupId);

    if (myGroupIds.length === 0) {
      reservationList = [];
    } else {
      reservationList = await db
        .select({
          id: reservations.id,
          startAt: reservations.startAt,
          endAt: reservations.endAt,
          status: reservations.status,
          headcount: reservations.headcount,
          facilityName: facilities.name,
          groupName: groups.name,
        })
        .from(reservations)
        .leftJoin(facilities, eq(reservations.facilityId, facilities.id))
        .leftJoin(groups, eq(reservations.groupId, groups.id))
        .where(inArray(reservations.groupId, myGroupIds))
        .orderBy(desc(reservations.createdAt))
        .all();
    }
  }

  return data({ session, reservationList });
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  provisional: {
    label: "仮予約",
    className: "bg-yellow-100 text-yellow-700",
  },
  approved: { label: "承認済み", className: "bg-green-100 text-green-700" },
  withdrawn: {
    label: "取り消し済み",
    className: "bg-gray-100 text-gray-600",
  },
  rejected: { label: "却下済み", className: "bg-red-100 text-red-700" },
  cancelled: {
    label: "キャンセル済み",
    className: "bg-gray-100 text-gray-600",
  },
  cancelled_by_staff: {
    label: "事務局キャンセル",
    className: "bg-red-100 text-red-700",
  },
};

export default function ReservationsPage({ loaderData }: Route.ComponentProps) {
  const { session, reservationList } = loaderData;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">
          {session.isStaff ? "全予約一覧" : "予約一覧"}
        </h1>
        {!session.isStaff && (
          <Link
            to="/reservations/new"
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            予約を申請する
          </Link>
        )}
      </div>

      {reservationList.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          予約がありません。
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  施設・設備
                </th>
                {session.isStaff && (
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    団体
                  </th>
                )}
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  日時
                </th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">
                  ステータス
                </th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reservationList.map((r) => {
                const status = STATUS_LABELS[r.status] ?? {
                  label: r.status,
                  className: "bg-gray-100 text-gray-600",
                };
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">
                      {r.facilityName}
                    </td>
                    {session.isStaff && (
                      <td className="px-4 py-3 text-gray-600">{r.groupName}</td>
                    )}
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {new Date(r.startAt).toLocaleDateString("ja-JP", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      {new Date(r.startAt).toLocaleTimeString("ja-JP", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" 〜 "}
                      {new Date(r.endAt).toLocaleTimeString("ja-JP", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-medium ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/reservations/${r.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        詳細
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
