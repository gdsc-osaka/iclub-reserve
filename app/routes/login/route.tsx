import { redirect } from "react-router";

import { AuthCard } from "~/components/auth/auth-card";
import { OtpCodeForm } from "~/components/auth/otp-code-form";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { isProfileCompleted } from "~/domain/authn/user-profile";
import { readRedirectTo, WELCOME_PATH, withRedirectTo } from "~/lib/auth/auth-redirect";
import { getRequestUser } from "~/lib/auth/auth-session.server";
import { readLastLoginMethod } from "~/lib/auth/last-login-method-cookie";

import type { Route } from "./+types/route";
import { EmailStep } from "./email-step";
import { useLoginForm } from "./use-login-form";

export function meta(_: Route.MetaArgs) {
  return [{ title: "ログイン・新規登録 | iclub-reserve" }];
}

/**
 * すでにログインしている人をログイン画面に留めない。
 *
 * お名前がまだ空の人（アカウントを作った直後に離脱した人）は
 * セットアップ画面へ、それ以外の人は元いたページへ送る。
 *
 * 併せて、前回このブラウザで使ったログイン方法も読んでおく。
 * ログイン方法の並び順は、最初の描画の時点で確定していないと
 * 画面が表示されたあとに入れ替わってしまうため。
 */
export function loader({ request, context }: Route.LoaderArgs) {
  const redirectTo = readRedirectTo(request);
  const user = getRequestUser(context);

  if (user) {
    throw redirect(
      isProfileCompleted(user) ? redirectTo : withRedirectTo(WELCOME_PATH, redirectTo),
    );
  }

  return { redirectTo, lastLoginMethod: readLastLoginMethod(request) };
}

/** 段階ごとのカードの説明文。段階を足したらここにも足す */
const stepDescriptions = {
  email:
    "メールアドレス宛に認証コードをお送りします。初めての方はそのままアカウントが作成されます。",
  otp: "メールに届いた認証コードを入力してください。",
};

/**
 * ログイン・新規登録画面。
 *
 * ログイン方法は 2 つある。
 *
 * - **メールの認証コード（OTP）** — 誰でも使える主導線。パスワードは使わない。
 *   この方式では「ログイン」と「新規登録」はサーバー側で同じ処理になる
 *   （未登録のメールアドレスならその場でアカウントが作られる）ため、
 *   画面もあえて分けずに 1 つにまとめている。
 * - **パスキー** — 登録済みの人だけが使える近道。
 *   ボタンからのほか、メールアドレスの入力欄のオートフィルからも選べる。
 *
 * 認証の段取りそのものは `useLoginForm` が持っていて、ここは段階に合う
 * 入力欄を出すだけにしている。
 *
 * この画面が担うのは本人確認までで、初めての人のお名前の登録は
 * ログイン後の `/welcome`（`routes/welcome/route.tsx`）が担当する。
 * 認証が済んだ時点でセッションはできているため、そこで離脱されても
 * ログインが必要な画面から改めてセットアップへ案内できる。
 */
export default function Login({ loaderData }: Route.ComponentProps) {
  const form = useLoginForm(loaderData);

  return (
    <AuthCard title="ログイン・新規登録" description={stepDescriptions[form.step]}>
      <div className="space-y-4">
        {form.message && (
          <Alert variant={form.message.kind === "error" ? "destructive" : "default"}>
            <AlertDescription>{form.message.text}</AlertDescription>
          </Alert>
        )}

        {form.step === "email" && (
          <EmailStep
            methods={form.methods}
            email={form.email}
            onEmailChange={form.setEmail}
            pending={form.pending}
            pendingMethod={form.pendingMethod}
            onSubmitEmail={() => form.sendOtp(false)}
            onPasskey={form.signInWithPasskey}
          />
        )}

        {form.step === "otp" && (
          <OtpCodeForm
            email={form.email}
            pending={form.pending}
            submitLabel={form.pending ? "確認中…" : "認証する"}
            onSubmit={form.verifyOtp}
            onResend={() => form.sendOtp(true)}
            onBack={form.backToEmail}
          />
        )}
      </div>
    </AuthCard>
  );
}
