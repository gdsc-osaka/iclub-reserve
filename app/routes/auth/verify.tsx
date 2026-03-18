import { eq } from "drizzle-orm";
import { data, Form, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/verify";
import { getDb } from "~/db/client";
import { users } from "~/db/schema";
import { generateId } from "~/lib/id";
import { createSession, setSessionCookie } from "~/lib/session";
import { verifyCode } from "~/lib/verification";

export function meta() {
  return [{ title: "認証コード入力 | iclub-reserve" }];
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const code = String(formData.get("code") ?? "").trim();

  if (!email || !code) {
    return data({ error: "認証コードを入力してください。" }, { status: 400 });
  }

  const stored = await verifyCode(env.KV, email, code);
  if (!stored) {
    return data(
      { error: "認証コードが正しくないか、有効期限が切れています。" },
      { status: 400 },
    );
  }

  const db = getDb(env);
  const userId = generateId();

  await db.insert(users).values({
    id: userId,
    email: stored.email,
    name: stored.name,
    passwordHash: stored.passwordHash,
    isStaff: false,
  });

  const token = await createSession(env.KV, {
    id: userId,
    email: stored.email,
    name: stored.name,
    isStaff: false,
  });

  const isSecure = new URL(request.url).protocol === "https:";
  throw redirect("/", {
    headers: { "Set-Cookie": setSessionCookie(token, isSecure) },
  });
}

export default function VerifyPage({ actionData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const demoCode = searchParams.get("demo_code"); // デモ用: URL に含まれたコード

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        {/* デモ用: 認証コードを直接表示するバナー */}
        {demoCode && (
          <div className="mb-4 bg-amber-50 border border-amber-300 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <span className="text-amber-500 text-lg shrink-0">✉️</span>
              <div>
                <p className="text-sm font-semibold text-amber-800 mb-1">
                  デモ: メール送信プレビュー
                </p>
                <p className="text-xs text-amber-700 mb-2">
                  本番環境では <strong>{email}</strong>{" "}
                  宛にメールが送信されます。
                </p>
                <p className="text-xs text-amber-600 mb-1">件名: 【iclub-reserve】メールアドレスの確認</p>
                <div className="bg-white border border-amber-200 rounded p-3 mt-2">
                  <p className="text-xs text-gray-600 mb-2">認証コード:</p>
                  <p className="text-3xl font-bold tracking-widest text-gray-900 text-center">
                    {demoCode}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-8">
          <h1 className="text-2xl font-bold text-center mb-2">
            認証コードを入力
          </h1>
          <p className="text-sm text-gray-500 text-center mb-6">
            {demoCode
              ? "上に表示された6桁のコードを入力してください。"
              : `${email} に送信した6桁のコードを入力してください。`}
          </p>

          {actionData?.error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
              {actionData.error}
            </div>
          )}

          <Form method="post" className="space-y-4">
            <input type="hidden" name="email" value={email} />

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                認証コード（6桁）
              </label>
              <input
                type="text"
                name="code"
                required
                maxLength={6}
                minLength={6}
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
                defaultValue={demoCode ?? ""}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="000000"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              登録を完了する
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}
