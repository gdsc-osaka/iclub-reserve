import { useState } from "react";
import { redirect, useNavigate } from "react-router";

import { AuthCard } from "~/components/auth/auth-card";
import {
  PASSKEY_STEP_DESCRIPTION,
  PASSKEY_STEP_TITLE,
  PasskeyRegistrationStep,
} from "~/components/auth/passkey-registration-step";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { isProfileCompleted } from "~/domain/auth/user-profile";
import { authClient } from "~/lib/auth/auth-client";
import { toAuthErrorMessage } from "~/lib/auth/auth-error-message";
import { LOGIN_PATH, readRedirectTo, withRedirectTo } from "~/lib/auth/auth-redirect";
import { getRequestUser } from "~/lib/auth/auth-session.server";
import { detectPasskeySupport } from "~/lib/auth/passkey-support";

import type { Route } from "./+types/onboarding";

export function meta(_: Route.MetaArgs) {
  return [{ title: "お名前の登録 | iclub-reserve" }];
}

/**
 * この画面を出してよい人かどうかを確かめる。
 *
 * - 未ログイン: ログイン画面へ。戻り先にはこの画面ではなく元のページを渡す
 *   （ログインし直せば、名前が空の人はこの画面へ自動で戻ってくるため）
 * - 登録済み: もうこの画面は不要なので、そのまま元のページへ返す
 */
export function loader({ request, context }: Route.LoaderArgs) {
  const redirectTo = readRedirectTo(request);
  const user = getRequestUser(context);

  if (!user) throw redirect(withRedirectTo(LOGIN_PATH, redirectTo));
  if (isProfileCompleted(user)) throw redirect(redirectTo);

  return { redirectTo };
}

/**
 * 今どの段階にいるか。
 *
 * - name: お名前の入力
 * - passkey: パスキーの登録のお誘い
 */
type Step = "name" | "passkey";

/**
 * 初回セットアップ画面。
 *
 * 認証コードでのログインは、未登録のメールアドレスならその場でアカウントを作る。
 * このとき名前は空のままなので、ログインの直後にこの画面でお名前を登録してもらう。
 *
 * お名前を登録したあと、パスキーを保存できる端末なら続けて登録を勧める。
 * ここが「初めてこのアプリを使う人にパスキーを知ってもらう」唯一の機会になる。
 *
 * ログイン画面と分けているのは、この時点ですでにセッションができているため。
 * ここで離脱されても名前は空のままなので、ログインが必要な画面のローダー
 * （`requireProfileCompletedUser`）が改めてこの画面へ案内してくれる。
 */
export default function Onboarding({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  // セットアップを終えたあとに戻すページ。
  const { redirectTo } = loaderData;

  const [step, setStep] = useState<Step>("name");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** セットアップを終えて、元のページへ進む。 */
  const finish = async () => {
    // 画面が切り替わるまで操作させたくないので pending は true のままにする。
    setPending(true);
    await navigate(redirectTo, { replace: true });
  };

  /** お名前を登録して、次の段階へ進む。 */
  const registerName = async () => {
    setPending(true);
    setErrorMessage(null);

    const { error } = await authClient.updateUser({ name: name.trim() });

    if (error) {
      setPending(false);
      setErrorMessage(
        toAuthErrorMessage(error, "お名前を登録できませんでした。もう一度お試しください。"),
      );
      return;
    }

    // パスキーを保存できる端末なら、続けて登録を勧める。
    //
    // お名前より後に置いているのは、この画面の本来の目的を先に終わらせるため。
    // パスキーの登録は任意なので、ここで離脱されてもお名前は残る。
    // 逆にすると、お名前が未登録のまま離脱されて、次のログインでまたこの画面に戻ってしまう。
    //
    // 判定は待ってから見る。描画に合わせて受け取る形（`usePasskeySupport`）だと、
    // 判定が終わる前にお名前を登録し終えた人に、勧めそこねてしまう。
    const { canRegisterOnThisDevice } = await detectPasskeySupport();

    if (canRegisterOnThisDevice) {
      setPending(false);
      setStep("passkey");
      return;
    }

    await finish();
  };

  // 段階によってカードの見出しごと差し替える。
  const { title, description } = {
    name: {
      title: "お名前の登録",
      description: "ようこそ。予約画面などで表示されるお名前を登録してください。",
    },
    passkey: { title: PASSKEY_STEP_TITLE, description: PASSKEY_STEP_DESCRIPTION },
  }[step];

  return (
    <AuthCard title={title} description={description}>
      <div className="space-y-4">
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {step === "name" && (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              void registerName();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="name">お名前</Label>
              <Input
                id="name"
                type="text"
                autoComplete="name"
                placeholder="大阪 太郎"
                required
                autoFocus
                disabled={pending}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={pending || name.trim() === ""}
            >
              {pending ? "登録中…" : "登録して次へ"}
            </Button>
          </form>
        )}

        {step === "passkey" && <PasskeyRegistrationStep onDone={() => void finish()} />}
      </div>
    </AuthCard>
  );
}
