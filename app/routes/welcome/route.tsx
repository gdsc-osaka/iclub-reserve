import { useState } from "react";
import { redirect, useNavigate } from "react-router";

import { AuthCard } from "~/components/auth/auth-card";
import {
  PASSKEY_STEP_DESCRIPTION,
  PASSKEY_STEP_TITLE,
  PasskeyRegistrationStep,
} from "~/components/auth/passkey-registration-step";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { isProfileCompleted, validateUserName } from "~/domain/authn/user-profile";
import { isFreshSession } from "~/domain/authn/session-freshness";
import { authClient } from "~/lib/auth/auth-client";
import { toAuthErrorMessage } from "~/lib/auth/auth-error-message";
import { LOGIN_PATH, readRedirectTo, withRedirectTo } from "~/lib/auth/auth-redirect";
import { getRequestSession, getRequestUser } from "~/lib/auth/auth-session.server";
import { detectPasskeySupport } from "~/lib/auth/passkey-support";

import type { Route } from "./+types/route";
import { NAME_STEP_DESCRIPTION, NAME_STEP_TITLE, NameStep } from "./name-step";

export function meta() {
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

  const session = getRequestSession(context);
  const canSuggestPasskey = session ? isFreshSession(session.createdAt, new Date()) : false;

  return { redirectTo, canSuggestPasskey };
}

/**
 * 今どの段階にいるか。
 *
 * - name: お名前の入力
 * - passkey: パスキーの登録のお誘い
 */
type Step = "name" | "passkey";

/** 段階ごとのカードの見出し。段階を足したらここにも足す */
const stepHeadings: Record<Step, { readonly title: string; readonly description: string }> = {
  name: { title: NAME_STEP_TITLE, description: NAME_STEP_DESCRIPTION },
  passkey: { title: PASSKEY_STEP_TITLE, description: PASSKEY_STEP_DESCRIPTION },
};

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
  const { redirectTo, canSuggestPasskey } = loaderData;

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
    setErrorMessage(null);

    const validation = validateUserName(name);
    if (validation.isErr()) {
      setErrorMessage(validation.error.userMessage);
      return;
    }

    setPending(true);

    const { error } = await authClient.updateUser({ name: validation.value });

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
    // ただし、ログインから 24 時間以上たっていたら勧めない（COND-019）。
    // 名前を登録しないまま時間がたったログインでもこの画面は開かれるが、
    // その場合パスキーの登録は Better Auth に断られるため。
    //
    // 端末の判定は待ってから見る。描画に合わせて受け取る形（`usePasskeySupport`）だと、
    // 判定が終わる前にお名前を登録し終えた人に、勧めそこねてしまう。
    if (canSuggestPasskey) {
      const { canRegisterOnThisDevice } = await detectPasskeySupport();

      if (canRegisterOnThisDevice) {
        setPending(false);
        setStep("passkey");
        return;
      }
    }

    await finish();
  };

  // 段階によってカードの見出しごと差し替える。
  const { title, description } = stepHeadings[step];

  return (
    <AuthCard title={title} description={description}>
      <div className="space-y-4">
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        {step === "name" && (
          <NameStep
            name={name}
            onNameChange={setName}
            pending={pending}
            onSubmit={() => void registerName()}
          />
        )}

        {step === "passkey" && <PasskeyRegistrationStep onDone={() => void finish()} />}
      </div>
    </AuthCard>
  );
}
