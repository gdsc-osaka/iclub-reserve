import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { type LoginMethod, toLoginMethodOrder } from "~/domain/authn/login-method";
import { isProfileCompleted } from "~/domain/authn/user-profile";
import { authClient } from "~/lib/auth/auth-client";
import { isPasskeyCancelledError, toAuthErrorMessage } from "~/lib/auth/auth-error-message";
import { PASSKEY_SUGGEST_PATH, WELCOME_PATH, withRedirectTo } from "~/lib/auth/auth-redirect";
import { rememberLastLoginMethod } from "~/lib/auth/last-login-method-cookie";
import { shouldSuggestPasskeyOnThisDevice } from "~/lib/auth/passkey-prompt-storage";
import { detectPasskeySupport, usePasskeySupport } from "~/lib/auth/passkey-support";

/**
 * ログイン画面（SCR-010）の段取りをまとめたもの。
 *
 * 描くこと以外をここへ寄せている。認証はどの段階でも
 * 「押す → 待つ → 進むか、理由を出す」の繰り返しで、
 * その待ち方の作法（下のパスキーの通し番号など）が画面の組み立てに混ざると、
 * どちらも追いにくくなるため。
 *
 * 画面から呼ぶものは待たずに済む形（戻り値なし）にそろえてある。
 * 結果はすべてこの中の状態に出るので、呼び出し側で待つ理由がない。
 */

/** 画面に出すお知らせ。エラーは赤色、それ以外は通常色で表示する。 */
export type Message = { readonly kind: "error" | "info"; readonly text: string };

/**
 * 今どの入力段階にいるか。
 *
 * - email: メールアドレスの入力（パスキーでのログインもこの段階から行う）
 * - otp: メールに届いた認証コードの入力
 */
export type Step = "email" | "otp";

/** ログイン画面が持つ状態と、そこへの操作 */
export interface LoginForm {
  readonly step: Step;
  readonly email: string;
  readonly message: Message | null;
  /** 何かの返事を待っているか。待っている間はどの操作も受け付けない */
  readonly pending: boolean;
  /** どのログイン方法の返事を待っているか。ボタンの文言に使う */
  readonly pendingMethod: LoginMethod | null;
  /** 出せるログイン方法を、前回使った順に並べたもの */
  readonly methods: readonly LoginMethod[];
  readonly setEmail: (email: string) => void;
  /** 認証コードをメールで送る。`isResend` は再送信ボタンから呼ばれたかどうか */
  readonly sendOtp: (isResend: boolean) => void;
  readonly verifyOtp: (otp: string) => void;
  readonly signInWithPasskey: () => void;
  /** 認証コードの入力をやめて、メールアドレスの入力へ戻る */
  readonly backToEmail: () => void;
}

/**
 * ログインの段取り。
 *
 * @param redirectTo ログインが必要なページから飛ばされてきた場合の、ログイン後の戻り先
 * @param lastLoginMethod 前回このブラウザで使ったログイン方法（ログイン方法の並び順に使う）
 */
export const useLoginForm = ({
  redirectTo,
  lastLoginMethod,
}: Readonly<{
  redirectTo: string;
  lastLoginMethod: LoginMethod | null;
}>): LoginForm => {
  const navigate = useNavigate();

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
   * 待ち受け中のパスキーの操作を、打ち切ったことにする。
   *
   * 待ち受けそのものを外から止める手段はライブラリにないため、
   * 通し番号だけを進めて、あとから返ってくる結果を捨てられるようにする。
   */
  const dropPendingPasskeyCeremony = () => {
    latestPasskeyCeremony.current += 1;
  };

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

    // 認証コードの入力へ進むと、オートフィルの目印を付けた入力欄がなくなる。
    // ただし下の useEffect の後始末は画面が描き変わったあとに走るため、
    // その隙にオートフィルが成功すると、認証コードを飛ばしてログインが終わってしまう。
    // 描き変える前に打ち切っておく。
    dropPendingPasskeyCeremony();
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
    // これがないと、この画面から離れたあとに、
    // 遅れて返ってきた結果で遷移やエラーの表示が起きてしまう。
    return dropPendingPasskeyCeremony;
    // ここで使っている関数は描画のたびに作り直されるが、待ち受けを始め直したいのは
    // ここに挙げた 3 つが変わったときだけなので、あえて依存に入れていない。
  }, [passkeySupport.canAutofill, step, autofillAttempt]);

  // 前回使った方法を先頭にして並べる。
  //
  // パスキーは「使える」前提で描いておき、対応していないと分かったときだけ取り下げる。
  // 判定はブラウザでしかできないが、その結果を待ってから描き始めると、
  // 画面が出たあとにボタンが割り込んで、カードの高さごと全体がずれてしまう。
  // WebAuthn を持たないブラウザは今では稀なので、ずれるのを稀なほうに寄せている。
  const methods = toLoginMethodOrder(lastLoginMethod).filter(
    (method) => method !== "passkey" || passkeySupport.status !== "unsupported",
  );

  return {
    step,
    email,
    message,
    pending,
    pendingMethod,
    methods,
    setEmail,
    sendOtp: (isResend) => void sendOtp(isResend),
    verifyOtp: (otp) => void verifyOtp(otp),
    signInWithPasskey: () => void signInWithPasskey(false),
    backToEmail: () => {
      setStep("email");
      setMessage(null);
    },
  };
};
