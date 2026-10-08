import { env } from "cloudflare:workers";
import { useState } from "react";
import { redirect, useNavigate, useNavigation } from "react-router";

import { AuthCard } from "~/components/auth/auth-card";
import {
  PASSKEY_STEP_DESCRIPTION,
  PASSKEY_STEP_TITLE,
  PasskeyRegistrationStep,
} from "~/components/auth/passkey-registration-step";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { type OnboardingStep, toPendingOnboardingSteps } from "~/domain/authn/onboarding";
import { isFreshSession } from "~/domain/authn/session-freshness";
import { isProfileCompleted, validateUserName } from "~/domain/authn/user-profile";
import { createDb } from "~/infra/db";
import { createTermsAcceptanceRepository } from "~/infra/user/terms-acceptance-repo";
import { authClient } from "~/lib/auth/auth-client";
import { toAuthErrorMessage } from "~/lib/auth/auth-error-message";
import { LOGIN_PATH, readRedirectTo, withRedirectTo } from "~/lib/auth/auth-redirect";
import { getRequestSession, getRequestUser } from "~/lib/auth/auth-session.server";
import { detectPasskeySupport } from "~/lib/auth/passkey-support";
import { userActionErrors } from "~/routes/_shared/user-error.server";
import { acceptTermsUseCase } from "~/usecases/user/accept-terms";

import type { Route } from "./+types/route";
import { NAME_STEP_DESCRIPTION, NAME_STEP_TITLE, NameStep } from "./name-step";
import {
  ACCEPT_TERMS_INTENT,
  TERMS_STEP_DESCRIPTION,
  TERMS_STEP_TITLE,
  TermsStep,
} from "./terms-step";

export function meta() {
  return [{ title: "初回設定 | iclub-reserve" }];
}

/**
 * この画面を出してよい人かどうかを確かめる。
 *
 * - 未ログイン: ログイン画面へ。戻り先にはこの画面ではなく元のページを渡す
 *   （ログインし直せば、本登録が済んでいない人はこの画面へ自動で戻ってくるため）
 * - 本登録済み: もうこの画面は不要なので、そのまま元のページへ返す
 *
 * 残っている段階（利用規約への同意・お名前の登録）のうち、最初のものを今の段階として返す。
 * 同意を送った後もこのローダーが読み直されるので、次の段階へは自然に進む。
 */
export function loader({ request, context }: Route.LoaderArgs) {
  const redirectTo = readRedirectTo(request);
  const user = getRequestUser(context);

  if (!user) throw redirect(withRedirectTo(LOGIN_PATH, redirectTo));

  const [currentStep] = toPendingOnboardingSteps(user);
  if (currentStep === undefined) throw redirect(redirectTo);

  const session = getRequestSession(context);
  const canSuggestPasskey = session ? isFreshSession(session.createdAt, new Date()) : false;

  return { redirectTo, currentStep, canSuggestPasskey };
}

/**
 * 利用規約への同意を記録する（REQ-033）。
 *
 * お名前がすでに登録済みの人（この仕組みより前に登録した人や、規約が改定された後の人）は、
 * 同意すれば本登録が済むので、そのまま元のページへ送る。
 * そうでない人には何も返さず、読み直したローダーがお名前の段階を返す。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const redirectTo = readRedirectTo(request);
  const user = getRequestUser(context);

  // この画面はログインしていなくても開ける（`PUBLIC_PATHS`）ので、ここで確かめる
  if (!user) throw redirect(withRedirectTo(LOGIN_PATH, redirectTo));

  const formData = await request.formData();

  // この画面が出している操作以外は受け付けない
  if (formData.get("intent") !== ACCEPT_TERMS_INTENT) {
    return { formError: "不正な操作です。" };
  }

  const result = await acceptTermsUseCase(
    { termsAcceptanceRepository: createTermsAcceptanceRepository(createDb(env.DB)) },
    {
      userId: user.id,
      agreed: formData.get("agreed"),
      termsVersion: formData.get("termsVersion"),
      now: new Date(),
    },
  );

  if (result.isErr()) {
    return userActionErrors({ where: "welcome.accept-terms", userId: user.id }, result.error);
  }

  if (isProfileCompleted(user)) throw redirect(redirectTo);

  return { formError: null };
}

/**
 * 今どの段階にいるか。
 *
 * - terms: 利用規約への同意
 * - name: お名前の入力
 * - passkey: パスキーの登録のお誘い
 *
 * terms と name はサーバーに記録が残るので、ローダーが決める（`OnboardingStep`）。
 * passkey は任意のお誘いで記録が無いので、お名前を登録し終えたときに画面の中で切り替える。
 */
type Step = OnboardingStep | "passkey";

/** 段階ごとのカードの見出し。段階を足したらここにも足す */
const stepHeadings: Record<Step, { readonly title: string; readonly description: string }> = {
  terms: { title: TERMS_STEP_TITLE, description: TERMS_STEP_DESCRIPTION },
  name: { title: NAME_STEP_TITLE, description: NAME_STEP_DESCRIPTION },
  passkey: { title: PASSKEY_STEP_TITLE, description: PASSKEY_STEP_DESCRIPTION },
};

/**
 * 初回セットアップ画面。
 *
 * 認証コードでのログインは、未登録のメールアドレスならその場でアカウントを作る。
 * このとき利用規約への同意も名前も無いので、ログインの直後にこの画面で
 * 規約に同意してもらい（REQ-033）、続けてお名前を登録してもらう。
 *
 * 同意をログイン画面ではなくここで求めるのは、ログイン画面ではそのメールアドレスが
 * 新規かどうかを出せないため（出すと、登録済みかどうかを調べる手段になる）。
 * 認証コードを確かめた後なら、本人のアカウントのことなので出してよい。
 *
 * この仕組みより前に登録した人や、規約が改定された後の人は、同意の段階だけを通る。
 *
 * お名前を登録したあと、パスキーを保存できる端末なら続けて登録を勧める。
 * ここが「初めてこのアプリを使う人にパスキーを知ってもらう」唯一の機会になる。
 *
 * ログイン画面と分けているのは、この時点ですでにセッションができているため。
 * ここで離脱されても同意や名前は空のままなので、ログインが必要な画面を開くと
 * ミドルウェア（`requireAuthentication`）が改めてこの画面へ案内してくれる。
 */
export default function Onboarding({ loaderData, actionData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const navigation = useNavigation();
  // セットアップを終えたあとに戻すページ。
  const { redirectTo, currentStep, canSuggestPasskey } = loaderData;

  // パスキーのお誘いに進んだかどうか。それまではローダーが決めた段階を出す
  const [suggestingPasskey, setSuggestingPasskey] = useState(false);
  const step: Step = suggestingPasskey ? "passkey" : currentStep;

  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [nameErrorMessage, setNameErrorMessage] = useState<string | null>(null);

  // 同意のフォームは画面のアクションへ送るので、送信中かどうかと失敗の理由はルーターから受け取る
  const submittingTerms = navigation.state !== "idle";
  const errorMessage = step === "terms" ? (actionData?.formError ?? null) : nameErrorMessage;

  /** セットアップを終えて、元のページへ進む。 */
  const finish = async () => {
    // 画面が切り替わるまで操作させたくないので pending は true のままにする。
    setPending(true);
    await navigate(redirectTo, { replace: true });
  };

  /** お名前を登録して、次の段階へ進む。 */
  const registerName = async () => {
    setNameErrorMessage(null);

    const validation = validateUserName(name);
    if (validation.isErr()) {
      setNameErrorMessage(validation.error.userMessage);
      return;
    }

    setPending(true);

    const { error } = await authClient.updateUser({ name: validation.value });

    if (error) {
      setPending(false);
      setNameErrorMessage(
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
        setSuggestingPasskey(true);
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

        {step === "terms" && <TermsStep pending={submittingTerms} />}

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
