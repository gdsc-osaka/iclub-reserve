import { data, Form, Link, NavLink, Outlet } from "react-router";
import type { Route } from "./+types/layout";
import { requireAuth } from "~/lib/auth";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireAuth(request, context.cloudflare.env);
  return data({ session });
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { session } = loaderData;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <Link
                to="/"
                className="font-bold text-gray-900 text-sm whitespace-nowrap"
              >
                iclub-reserve
              </Link>
              <div className="hidden sm:flex items-center gap-4 text-sm">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) =>
                    isActive
                      ? "text-blue-600 font-medium"
                      : "text-gray-600 hover:text-gray-900"
                  }
                >
                  カレンダー
                </NavLink>
                <NavLink
                  to="/reservations"
                  className={({ isActive }) =>
                    isActive
                      ? "text-blue-600 font-medium"
                      : "text-gray-600 hover:text-gray-900"
                  }
                >
                  予約一覧
                </NavLink>
                <NavLink
                  to="/groups"
                  className={({ isActive }) =>
                    isActive
                      ? "text-blue-600 font-medium"
                      : "text-gray-600 hover:text-gray-900"
                  }
                >
                  団体
                </NavLink>
                <NavLink
                  to="/calendars"
                  className={({ isActive }) =>
                    isActive
                      ? "text-blue-600 font-medium"
                      : "text-gray-600 hover:text-gray-900"
                  }
                >
                  カレンダー購読
                </NavLink>
                {session.isStaff && (
                  <NavLink
                    to="/admin/facilities"
                    className={({ isActive }) =>
                      isActive
                        ? "text-blue-600 font-medium"
                        : "text-gray-600 hover:text-gray-900"
                    }
                  >
                    施設管理
                  </NavLink>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 hidden sm:block">
                {session.name}
                {session.isStaff && (
                  <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                    事務局
                  </span>
                )}
              </span>
              <Form method="post" action="/logout">
                <button
                  type="submit"
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  ログアウト
                </button>
              </Form>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Outlet />
      </main>
    </div>
  );
}
