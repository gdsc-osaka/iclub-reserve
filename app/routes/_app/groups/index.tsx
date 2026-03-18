import { data, Link } from "react-router";
import type { Route } from "./+types/index";
import { getDb } from "~/db/client";
import { groups, memberships } from "~/db/schema";
import { requireAuth } from "~/lib/auth";
import { and, eq, inArray } from "drizzle-orm";

export function meta() {
  return [{ title: "団体一覧 | iclub-reserve" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const session = await requireAuth(request, env);
  const db = getDb(env);

  let groupList;
  if (session.isStaff) {
    groupList = await db.select().from(groups).all();
  } else {
    const myMemberships = await db
      .select({ groupId: memberships.groupId })
      .from(memberships)
      .where(eq(memberships.userId, session.userId))
      .all();
    const myGroupIds = myMemberships.map((m) => m.groupId);
    groupList =
      myGroupIds.length > 0
        ? await db
            .select()
            .from(groups)
            .where(inArray(groups.id, myGroupIds))
            .all()
        : [];
  }

  return data({ session, groupList });
}

export default function GroupsPage({ loaderData }: Route.ComponentProps) {
  const { session, groupList } = loaderData;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-gray-900">
          {session.isStaff ? "団体一覧（全体）" : "所属団体"}
        </h1>
        <Link
          to="/groups/new"
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          団体を作成する
        </Link>
      </div>

      {groupList.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
          所属している団体がありません。
        </div>
      ) : (
        <div className="grid gap-3">
          {groupList.map((g) => (
            <div
              key={g.id}
              className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-gray-900">{g.name}</span>
                {!g.isActive && (
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">
                    無効
                  </span>
                )}
              </div>
              <Link
                to={`/groups/${g.id}`}
                className="text-sm text-blue-600 hover:underline"
              >
                管理
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
