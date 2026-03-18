import { data, Form, Link, redirect } from "react-router";
import type { Route } from "./+types/login";
import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { users } from "~/db/schema";
import { verifyPassword } from "~/lib/password";
import { createSession, getSessionCookie, setSessionCookie } from "~/lib/session";

export function meta() {
  return [{ title: "ログイン | iclub-reserve" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const token = getSessionCookie(request);
  if (token) {
    const session = await import("~/lib/session").then((m) =>
      m.getSession(context.cloudflare.env.KV, token),
    );
    if (session) throw redirect("/");
  }
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return data({ error: "メールアドレスとパスワードを入力してください。" }, { status: 400 });
  }

  const db = getDb(env);
  const user = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return data({ error: "メールアドレスまたはパスワードが正しくありません。" }, { status: 401 });
  }

  const token = await createSession(env.KV, user);
  const isSecure = new URL(request.url).protocol === "https:";

  throw redirect("/", {
    headers: { "Set-Cookie": setSessionCookie(token, isSecure) },
  });
}

export default function LoginPage({ actionData }: Route.ComponentProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold text-center mb-6">
          iclub-reserve ログイン
        </h1>

        {actionData?.error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
            {actionData.error}
          </div>
        )}

        <Form method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="you@osaka-u.ac.jp"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              パスワード
            </label>
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            ログイン
          </button>
        </Form>

        <p className="mt-4 text-center text-sm text-gray-600">
          アカウントをお持ちでない方は{" "}
          <Link to="/register" className="text-blue-600 hover:underline">
            新規登録
          </Link>
        </p>
      </div>
    </div>
  );
}
