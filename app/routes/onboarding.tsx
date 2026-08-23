import { useState } from "react";
import { redirect, useNavigate } from "react-router";

import { AuthCard } from "~/components/auth/auth-card";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { isProfileCompleted } from "~/domain/auth/user-profile";
import { authClient } from "~/lib/auth-client";
import { toAuthErrorMessage } from "~/lib/auth-error-message";
import { LOGIN_PATH, readRedirectTo, withRedirectTo } from "~/lib/auth-redirect";
import { getRequestUser } from "~/lib/auth-session.server";

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
 * 初回セットアップ画面。
 *
 * 認証コードでのログインは、未登録のメールアドレスならその場でアカウントを作る。
 * このとき名前は空のままなので、ログインの直後にこの画面でお名前を登録してもらう。
 *
 * ログイン画面と分けているのは、この時点ですでにセッションができているため。
 * ここで離脱されても名前は空のままなので、ログインが必要な画面のローダー
 * （`requireProfileCompletedUser`）が改めてこの画面へ案内してくれる。
 */
export default function Onboarding({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  // セットアップを終えたあとに戻すページ。
  const { redirectTo } = loaderData;

  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** お名前を登録して、元のページへ進む。 */
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

    // 画面が切り替わるまで操作させたくないので pending は true のままにする。
    await navigate(redirectTo, { replace: true });
  };

  return (
    <AuthCard
      title="お名前の登録"
      description="ようこそ。予約画面などで表示されるお名前を登録してください。"
    >
      <div className="space-y-4">
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

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
            {pending ? "登録中…" : "登録して始める"}
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
