import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { redirect, useNavigate } from "react-router";

import { AuthCard } from "~/components/auth/auth-card";
import { OtpCodeForm } from "~/components/auth/otp-code-form";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ALLOWED_EMAIL_DOMAINS_LABEL } from "~/domain/auth/allowed-email-domain";
import { type LoginMethod, toLoginMethodOrder } from "~/domain/auth/login-method";
import { isProfileCompleted } from "~/domain/auth/user-profile";
import { authClient } from "~/lib/auth/auth-client";
import { isPasskeyCancelledError, toAuthErrorMessage } from "~/lib/auth/auth-error-message";
import {
  PASSKEY_SUGGEST_PATH,
  readRedirectTo,
  WELCOME_PATH,
  withRedirectTo,
} from "~/lib/auth/auth-redirect";
import { getRequestUser } from "~/lib/auth/auth-session.server";
import { readLastLoginMethod, rememberLastLoginMethod } from "~/lib/auth/last-login-method-cookie";
import { shouldSuggestPasskeyOnThisDevice } from "~/lib/auth/passkey-prompt-storage";
import { detectPasskeySupport, usePasskeySupport } from "~/lib/auth/passkey-support";

import type { Route } from "./+types/login";

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

/** 画面に出すお知らせ。エラーは赤色、それ以外は通常色で表示する。 */
type Message = { readonly kind: "error" | "info"; readonly text: string };

/**
 * 今どの入力段階にいるか。
 *
 * - email: メールアドレスの入力（パスキーでのログインもこの段階から行う）
 * - otp: メールに届いた認証コードの入力
 */
type Step = "email" | "otp";

/**
 * ログイン方法の間に挟む「または」の区切り。
 *
 * shadcn/ui のログイン画面の作例と同じく、横線の上に文字を重ねている。
 */
function MethodDivider() {
  return (
    <div className="relative text-center text-xs text-muted-foreground after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
      <span className="relative z-10 bg-card px-2">または</span>
    </div>
  );
}

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
 * この画面が担うのは本人確認までで、初めての人のお名前の登録は
 * ログイン後の `/welcome`（`routes/onboarding.tsx`）が担当する。
 * 認証が済んだ時点でセッションはできているため、そこで離脱されても
 * ログインが必要な画面から改めてセットアップへ案内できる。
 */
export default function Login({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  // redirectTo: ログインが必要なページから飛ばされてきた場合の、ログイン後の戻り先。
  // lastLoginMethod: 前回このブラウザで使ったログイン方法（ログイン方法の並び順に使う）。
  const { redirectTo, lastLoginMethod } = loaderData;

  const passkeySupport = usePasskeySupport();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<Message | null>(null);

  /**
   * どのログイン方法の返事を待っているか。待っていなければ null。
   *
   * 待っている間はどの操作も受け付けないので、
   * 「操作できるかどうか」と「どれを押したのか」をこの 1 つの値で表している。
   * 後者はボタンの文言に使う（パスキーを待っている最中に
   * メール側のボタンが「送信中…」になってしまうのを防ぐため）。
   */
  const [pendingMethod, setPendingMethod] = useState<LoginMethod | null>(null);
  const pending = pendingMethod !== null;

  /**
   * 今どのパスキー操作を待っているかの通し番号。
   *
   * パスキーの操作は、ブラウザ全体で同時に 1 つしか走らせられない。
   * あとから始めた操作が先の操作を打ち切る作りになっているため、
   * オートフィルを待っている最中にボタンを押されると、
   * 先に始めたオートフィル側が「中断された」という結果で返ってくる。
   *
   * その古い結果で画面を書き換えてしまわないよう、
   * 操作を始めるたびに番号を進め、戻ってきたときに自分が最新かを確かめる。
   */
  const latestPasskeyCeremony = useRef(0);

  /**
   * オートフィルの待ち受けをやり直すための番号。
   *
   * 増やすと、下の `useEffect` がもう一度待ち受けを始める。
   */
  const [autofillAttempt, setAutofillAttempt] = useState(0);

  /**
   * ログインを終えた人を、次にどの画面へ送るかを決める。
   *
   * 1. お名前がまだの人（アカウントができたばかりの人）はセットアップ画面へ。
   *    パスキーの登録もその画面が続けて勧めるので、ここでは何もしない。
   * 2. この端末にパスキーを保存できて、勧める頃合いなら、勧める画面へ。
   *    すでにパスキーを持っているかどうかは、その画面のローダーが確かめる。
   * 3. どちらでもなければ、元いたページへ。
   *
   * 端末の判定は待ってから見る。描画に合わせて受け取る形（`usePasskeySupport`）だと、
   * 判定が終わる前に認証を終えた人に、勧めそこねてしまう。
   */
  const toNextPath = async (
    user: { readonly name: string },
    method: LoginMethod,
  ): Promise<string> => {
    if (!isProfileCompleted(user)) return withRedirectTo(WELCOME_PATH, redirectTo);

    // パスキーでログインできた人は、当然すでにパスキーを持っている。
    if (method === "passkey") return redirectTo;

    const { canRegisterOnThisDevice } = await detectPasskeySupport();

    if (canRegisterOnThisDevice && shouldSuggestPasskeyOnThisDevice()) {
      return withRedirectTo(PASSKEY_SUGGEST_PATH, redirectTo);
    }

    return redirectTo;
  };

  /**
   * ログインを終えて、次の画面へ進む。
   *
   * @param user ログインした人
   * @param method 実際に使ったログイン方法
   */
  const finishLogin = async (user: { readonly name: string }, method: LoginMethod) => {
    // 次に来たとき、この方法を先頭に出せるよう覚えておく。
    rememberLastLoginMethod(method);
    // 画面が切り替わるまで操作させたくないので、待っている状態のままにする。
    setPendingMethod(method);
    await navigate(await toNextPath(user, method), { replace: true });
  };

  /**
   * 認証コードをメールで送信し、コード入力の段階へ進む。
   *
   * @param isResend 再送信ボタンから呼ばれたかどうか（画面に出す文言だけが変わる）
   */
  const sendOtp = async (isResend: boolean) => {
    // ドメインの制限はサーバー側で判定する。
    // 「登録済みなら別ドメインでもログインできる」という判断はサーバーにしかできないため、
    // ここで先回りして弾くと既存ユーザーを締め出してしまう。
    setPendingMethod("email-otp");
    setMessage(null);

    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "sign-in",
    });

    setPendingMethod(null);

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
   * 入力された認証コードで認証する。
   *
   * 未登録のメールアドレスならこの時点でアカウントが作られる。
   * その場合は名前が空になるので、セットアップ画面へ送る。
   */
  const verifyOtp = async (otp: string) => {
    setPendingMethod("email-otp");
    setMessage(null);

    const { data, error } = await authClient.signIn.emailOtp({ email, otp });

    if (error) {
      setPendingMethod(null);
      setMessage({
        kind: "error",
        text: toAuthErrorMessage(error, "認証できませんでした。もう一度お試しください。"),
      });
      return;
    }

    await finishLogin(data.user, "email-otp");
  };

  /**
   * パスキーでログインする。
   *
   * ボタンからの呼び出しと、入力欄のオートフィルからの呼び出しを兼ねる。
   * 違うのは「利用者を待たせるかどうか」だけで、使う API は同じ。
   *
   * @param autoFill オートフィルの候補として待ち受けるかどうか
   */
  const signInWithPasskey = async (autoFill: boolean) => {
    const ceremony = ++latestPasskeyCeremony.current;

    // オートフィルは候補が選ばれるまでずっと待ち続ける。
    // その間もメールアドレスは入力できないと困るので、画面を止めるのはボタンのときだけ。
    if (!autoFill) {
      setPendingMethod("passkey");
      setMessage(null);
    }

    const { data, error } = await authClient.signIn.passkey({ autoFill });

    // 別の操作に打ち切られた古い結果なら、何もしない。
    if (latestPasskeyCeremony.current !== ceremony) return;

    if (error) {
      if (!autoFill) {
        setPendingMethod(null);
        // ボタンを押した時点で、オートフィルの待ち受けも打ち切られている。
        // 入力欄からまた選べるよう、待ち受け直す。
        setAutofillAttempt((attempt) => attempt + 1);
      }

      // ダイアログを閉じたのは失敗ではなく「やめる」という操作。
      // 赤いエラーを出すと壊れたように見えるので、黙って元の表示に戻す。
      //
      // オートフィルの待ち受けは、対応していないブラウザや
      // 目印の付いた入力欄が見当たらないときも同じ扱いで返ってくる。
      // こちらから勝手に始めたものなので、これも黙って終える。
      if (isPasskeyCancelledError(error)) return;

      setMessage({
        kind: "error",
        text: toAuthErrorMessage(
          error,
          "パスキーでログインできませんでした。メールの認証コードをお試しください。",
        ),
      });
      return;
    }

    await finishLogin(data.user, "passkey");
  };

  /**
   * メールアドレスの入力欄のオートフィルに、パスキーを候補として出す。
   *
   * ここで始めた待ち受けは、利用者が候補を選ぶまで終わらない。
   * 選ばれずに終わる（＝打ち切られる）のは次のときで、どれも表示は変えない。
   *
   * - パスキーでログインボタンを押されたとき
   * - 認証コードの入力へ進んで、目印の付いた入力欄がなくなったとき
   * - ログインを終えるなどして、この画面から離れたとき
   *
   * 待ち受けを外から止める手段はライブラリにないため、
   * 上の通し番号で古い結果を捨てる形にしている。
   */
  useEffect(() => {
    if (!passkeySupport.canAutofill) return;
    // オートフィルの対象になる入力欄があるのは、この段階だけ。
    if (step !== "email") return;

    void signInWithPasskey(true);

    // 待ち受けたまま画面が変わるときの後始末。
    // 待ち受け自体は止められないので、通し番号だけ進めておく。
    // こうすれば、あとから戻ってきた結果を古いものとして捨てられる。
    // これがないと、認証コードの入力へ進んだあとに
    // 関係のないエラーが出たり、画面から離れたあとに遷移が起きたりする。
    return () => {
      latestPasskeyCeremony.current += 1;
    };
    // signInWithPasskey は描画のたびに作り直されるが、待ち受けを始め直したいのは
    // ここに挙げた 3 つが変わったときだけなので、あえて依存に入れていない。
  }, [passkeySupport.canAutofill, step, autofillAttempt]);

  /** メールアドレスを入力して、認証コードを送ってもらうフォーム。 */
  const emailOtpForm = (
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
          // 末尾の webauthn が、オートフィルにパスキーを出すための目印。
          // ブラウザはこの目印が付いた入力欄を探して候補を出すので、
          // 外すとオートフィルからのログインができなくなる。
          autoComplete="email webauthn"
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
        {pendingMethod === "email-otp" ? "送信中…" : "メールアドレスで続ける"}
      </Button>
    </form>
  );

  /**
   * パスキーでログインするボタン。
   *
   * 先頭に来ても見た目は変えない。塗りつぶしのボタンは
   * 「メールアドレスで続ける」に譲り、こちらは枠線だけにしておく。
   * 並び順で色まで入れ替わると、開くたびに画面の印象が変わってしまうため。
   */
  const passkeyButton = (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={() => void signInWithPasskey(false)}
        disabled={pending}
      >
        {pendingMethod === "passkey" ? "確認中…" : "パスキーでログイン"}
      </Button>
      <p className="text-xs text-muted-foreground">
        登録済みの端末なら、顔認証・指紋・画面ロックだけでログインできます。
      </p>
    </div>
  );

  const methodContents: Record<LoginMethod, ReactNode> = {
    "email-otp": emailOtpForm,
    passkey: passkeyButton,
  };

  // 前回使った方法を先頭にして並べる。
  //
  // パスキーは「使える」前提で描いておき、対応していないと分かったときだけ取り下げる。
  // 判定はブラウザでしかできないが、その結果を待ってから描き始めると、
  // 画面が出たあとにボタンが割り込んで、カードの高さごと全体がずれてしまう。
  // WebAuthn を持たないブラウザは今では稀なので、ずれるのを稀なほうに寄せている。
  const methods = toLoginMethodOrder(lastLoginMethod).filter(
    (method) => method !== "passkey" || passkeySupport.status !== "unsupported",
  );

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
          <div className="space-y-4">
            {methods.map((method, index) => (
              <Fragment key={method}>
                {index > 0 && <MethodDivider />}
                {methodContents[method]}
              </Fragment>
            ))}
          </div>
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
