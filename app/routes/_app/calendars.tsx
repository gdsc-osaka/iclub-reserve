import { data } from "react-router";
import type { Route } from "./+types/calendars";
import { getDb } from "~/db/client";
import { facilities } from "~/db/schema";
import { requireAuth } from "~/lib/auth";
import { eq } from "drizzle-orm";

export function meta() {
  return [{ title: "カレンダー購読 | iclub-reserve" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  await requireAuth(request, env);
  const db = getDb(env);

  const facilityList = await db
    .select({
      id: facilities.id,
      name: facilities.name,
      googleCalendarId: facilities.googleCalendarId,
      calendarUrl: facilities.calendarUrl,
    })
    .from(facilities)
    .where(eq(facilities.isActive, true))
    .all();

  return data({ facilityList });
}

export default function CalendarsPage({ loaderData }: Route.ComponentProps) {
  const { facilityList } = loaderData;

  return (
    <div>
      <h1 className="text-xl font-bold text-gray-900 mb-2">カレンダー購読</h1>
      <p className="text-sm text-gray-500 mb-6">
        各施設・設備の予約状況を Google Calendar で確認できます。
      </p>

      <div className="grid gap-3">
        {facilityList.map((f) => (
          <div
            key={f.id}
            className="bg-white rounded-lg border border-gray-200 p-4"
          >
            <h2 className="font-medium text-gray-900 mb-2">{f.name}</h2>
            <div className="flex flex-wrap gap-2">
              {f.googleCalendarId ? (
                <a
                  href={`https://calendar.google.com/calendar/r?cid=${f.googleCalendarId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm bg-blue-50 text-blue-700 px-3 py-1.5 rounded hover:bg-blue-100 transition-colors"
                >
                  Google Calendar に追加
                </a>
              ) : null}
              {f.calendarUrl ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={f.calendarUrl}
                    className="text-xs border border-gray-200 rounded px-2 py-1.5 text-gray-600 w-72 bg-gray-50"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <span className="text-xs text-gray-400">iCal URL</span>
                </div>
              ) : null}
              {!f.googleCalendarId && !f.calendarUrl && (
                <span className="text-sm text-gray-400">
                  カレンダーが未設定です
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
