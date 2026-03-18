import { data, Form, Link, redirect } from "react-router";
import type { Route } from "./+types/register";
import { eq } from "drizzle-orm";
import { getDb } from "~/db/client";
import { users } from "~/db/schema";
import { isOsakaUDomain } from "~/lib/auth";
import { hashPassword } from "~/lib/password";
import {
  generateVerificationCode,
  storeVerificationCode,
} from "~/lib/verification";

export function meta() {
  return [{ title: "アカウント登録 | iclub-reserve" }];
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const agree = formData.get("agree");

  if (!email || !name || !password) {
    return data({ error: "すべての項目を入力してください。" }, { status: 400 });
  }

  if (!agree) {
    return data(
      { error: "利用規約に同意する必要があります。" },
      { status: 400 },
    );
  }

  if (!isOsakaUDomain(email)) {
    return data(
      {
        error:
          "登録できるメールアドレスは osaka-u.ac.jp ドメイン（サブドメイン含む）のみです。",
      },
      { status: 400 },
    );
  }

  if (password.length < 8) {
    return data(
      { error: "パスワードは8文字以上で設定してください。" },
      { status: 400 },
    );
  }

  // 既存ユーザーチェック
  const db = getDb(env);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (existing) {
    return data(
      { error: "このメールアドレスはすでに登録されています。" },
      { status: 400 },
    );
  }

  const passwordHash = await hashPassword(password);
  const code = generateVerificationCode();

  await storeVerificationCode(env.KV, email, code, {
    name,
    email,
    passwordHash,
  });

  // メール送信
  if (env.RESEND_API_KEY) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "iclub-reserve <noreply@iclub-reserve.osaka-u.ac.jp>",
        to: email,
        subject: "【iclub-reserve】メールアドレスの確認",
        html: `
          <p>${name} 様</p>
          <p>iclub-reserve へのご登録ありがとうございます。</p>
          <p>以下の認証コードを入力して、登録を完了してください。</p>
          <p style="font-size:2em;font-weight:bold;letter-spacing:0.2em;">${code}</p>
          <p>このコードは30分間有効です。</p>
        `,
      }),
    });
  }

  throw redirect(
    `/register/verify?email=${encodeURIComponent(email)}`,
  );
}

export default function RegisterPage({ actionData }: Route.ComponentProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-8">
        <h1 className="text-2xl font-bold text-center mb-2">新規アカウント登録</h1>
        <p className="text-sm text-gray-500 text-center mb-6">
          osaka-u.ac.jp ドメインのメールアドレスが必要です
        </p>

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
              氏名
            </label>
            <input
              type="text"
              name="name"
              required
              autoComplete="name"
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="大阪 太郎"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              パスワード（8文字以上）
            </label>
            <input
              type="password"
              name="password"
              required
              autoComplete="new-password"
              minLength={8}
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-start gap-2">
            <input
              type="checkbox"
              name="agree"
              id="agree"
              required
              className="mt-0.5"
            />
            <label htmlFor="agree" className="text-sm text-gray-600">
              <a
                href="/terms"
                target="_blank"
                className="text-blue-600 hover:underline"
              >
                i-Club 利用規約
              </a>
              に同意します
            </label>
          </div>

          <button
            type="submit"
            className="w-full bg-blue-600 text-white rounded py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            認証コードを送信
          </button>
        </Form>

        <p className="mt-4 text-center text-sm text-gray-600">
          すでにアカウントをお持ちの方は{" "}
          <Link to="/login" className="text-blue-600 hover:underline">
            ログイン
          </Link>
        </p>
      </div>
    </div>
  );
}
