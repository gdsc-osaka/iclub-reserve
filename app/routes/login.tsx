import { useState } from "react";
import { redirect, useNavigate } from "react-router";

import { AuthCard } from "~/components/auth/auth-card";
import { OtpCodeForm } from "~/components/auth/otp-code-form";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ALLOWED_EMAIL_DOMAINS_LABEL } from "~/domain/auth/allowed-email-domain";
import { isProfileCompleted } from "~/domain/auth/user-profile";
import { authClient } from "~/lib/auth/auth-client";
import { toAuthErrorMessage } from "~/lib/auth/auth-error-message";
import {
  PASSKEY_SUGGEST_PATH,
  readRedirectTo,
  WELCOME_PATH,
  withRedirectTo,
} from "~/lib/auth/auth-redirect";
import { getRequestUser } from "~/lib/auth/auth-session.server";
import { shouldSuggestPasskeyOnThisDevice } from "~/lib/auth/passkey-prompt-storage";
import { usePasskeySupport } from "~/lib/auth/passkey-support";

import type { Route } from "./+types/login";

export function meta(_: Route.MetaArgs) {
  return [{ title: "ログイン・新規登録 | iclub-reserve" }];
}

/**
 * すでにログインしている人をログイン画面に留めない。
 *
 * お名前がまだ空の人（アカウントを作った直後に離脱した人）は
 * セットアップ画面へ、それ以外の人は元いたページへ送る。
 */
export function loader({ request, context }: Route.LoaderArgs) {
  const redirectTo = readRedirectTo(request);
  const user = getRequestUser(context);

  if (user) {
    throw redirect(
      isProfileCompleted(user) ? redirectTo : withRedirectTo(WELCOME_PATH, redirectTo),
    );
  }

  return { redirectTo };
}

/** 画面に出すお知らせ。エラーは赤色、それ以外は通常色で表示する。 */
type Message = { readonly kind: "error" | "info"; readonly text: string };

/**
 * 今どの入力段階にいるか。
 *
 * - email: メールアドレスの入力
 * - otp: メールに届いた認証コードの入力
 */
type Step = "email" | "otp";

/**
 * ログイン・新規登録画面。
 *
 * パスワードは使わず、メールアドレス宛に届く認証コード（OTP）で本人確認する。
 * この方式では「ログイン」と「新規登録」はサーバー側で同じ処理になる
 * （未登録のメールアドレスならその場でアカウントが作られる）ため、
 * 画面もあえて分けずに 1 つにまとめている。
 *
 * この画面が担うのは本人確認までで、初めての人のお名前の登録は
 * ログイン後の `/welcome`（`routes/onboarding.tsx`）が担当する。
 * 認証が済んだ時点でセッションはできているため、そこで離脱されても
 * ログインが必要な画面から改めてセットアップへ案内できる。
 */
export default function Login({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  // ログインが必要なページから飛ばされてきた場合は、ログイン後にそのページへ戻す。
  const { redirectTo } = loaderData;

  const passkeySupport = usePasskeySupport();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  /**
   * 認証コードをメールで送信し、コード入力の段階へ進む。
   *
   * @param isResend 再送信ボタンから呼ばれたかどうか（画面に出す文言だけが変わる）
   */
  const sendOtp = async (isResend: boolean) => {
    // ドメインの制限はサーバー側で判定する。
    // 「登録済みなら別ドメインでもログインできる」という判断はサーバーにしかできないため、
    // ここで先回りして弾くと既存ユーザーを締め出してしまう。
    setPending(true);
    setMessage(null);

    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });

    setPending(false);

    if (error) {
      setMessage({
        kind: "error",
        text: toAuthErrorMessage(
          error,
          "認証コードを送信できませんでした。時間をおいてもう一度お試しください。",
        ),
      });
      return;
    }

    setStep("otp");
    if (isResend) {
      setMessage({ kind: "info", text: "認証コードを再送信しました。" });
    }
  };

  /**
   * ログインを終えた人を、次にどの画面へ送るかを決める。
   *
   * 1. お名前がまだの人（アカウントができたばかりの人）はセットアップ画面へ。
   *    パスキーの登録もその画面が続けて勧めるので、ここでは何もしない。
   * 2. この端末にパスキーを保存できて、勧める頃合いなら、勧める画面へ。
   *    すでにパスキーを持っているかどうかは、その画面のローダーが確かめる。
   * 3. どちらでもなければ、元いたページへ。
   */
  const toNextPath = (user: { readonly name: string }): string => {
    if (!isProfileCompleted(user)) return withRedirectTo(WELCOME_PATH, redirectTo);

    if (passkeySupport.canRegisterOnThisDevice && shouldSuggestPasskeyOnThisDevice()) {
      return withRedirectTo(PASSKEY_SUGGEST_PATH, redirectTo);
    }

    return redirectTo;
  };

  /**
   * 入力された認証コードで認証する。
   *
   * 未登録のメールアドレスならこの時点でアカウントが作られる。
   * その場合は名前が空になるので、セットアップ画面へ送る。
   */
  const verifyOtp = async (otp: string) => {
    setPending(true);
    setMessage(null);

    const { data, error } = await authClient.signIn.emailOtp({ email, otp });

    if (error) {
      setPending(false);
      setMessage({
        kind: "error",
        text: toAuthErrorMessage(error, "認証できませんでした。もう一度お試しください。"),
      });
      return;
    }

    // 画面が切り替わるまで操作させたくないので pending は true のままにする。
    await navigate(toNextPath(data.user), { replace: true });
  };

  const description = {
    email:
      "メールアドレス宛に認証コードをお送りします。初めての方はそのままアカウントが作成されます。",
    otp: "メールに届いた認証コードを入力してください。",
  }[step];

  return (
    <AuthCard title="ログイン・新規登録" description={description}>
      <div className="space-y-4">
        {message && (
          <Alert variant={message.kind === "error" ? "destructive" : "default"}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        {step === "email" && (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void sendOtp(false);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="example@osaka-u.ac.jp"
                required
                disabled={pending}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                aria-describedby="email-hint"
              />
              <p id="email-hint" className="text-xs text-muted-foreground">
                {ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスのみご利用いただけます。
              </p>
            </div>

            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "送信中…" : "メールアドレスで続ける"}
            </Button>
          </form>
        )}

        {step === "otp" && (
          <OtpCodeForm
            email={email}
            pending={pending}
            submitLabel={pending ? "確認中…" : "認証する"}
            onSubmit={(otp) => void verifyOtp(otp)}
            onResend={() => void sendOtp(true)}
            onBack={() => {
              setStep("email");
              setMessage(null);
            }}
          />
        )}
      </div>
    </AuthCard>
  );
}
