import { useState } from "react";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth/auth-client";
import { isPasskeyCancelledError, toAuthErrorMessage } from "~/lib/auth/auth-error-message";
import {
  forgetPasskeyPromptDismissals,
  rememberPasskeyPromptDismissed,
} from "~/lib/auth/passkey-prompt-storage";

/**
 * カードの見出し。
 *
 * 初回セットアップ（`/welcome`）と、あとから勧める画面（`/passkey/suggest`）の
 * どちらでも同じ文言を使いたいので、ここから配っている。
 */
export const PASSKEY_STEP_TITLE = "次回からパスキーでかんたんログイン";

/** 見出しの下に出す説明。 */
export const PASSKEY_STEP_DESCRIPTION =
  "メールの認証コードを待たずに、顔認証・指紋・画面ロックだけでログインできるようになります。";

type PasskeyRegistrationStepProps = {
  /**
   * 登録を終えたとき、または「あとで」を選ばれたときに呼ばれる。
   *
   * 次の画面へ進めるのは画面側の仕事なので、ここでは何もしない。
   */
  onDone: () => void;
};

/**
 * パスキーの登録を勧める画面の中身。
 *
 * 初回セットアップの最後（要件 1）と、メールの認証コードでログインしている人へ
 * ときどき出す画面（要件 3）の両方から使う。
 * どちらも伝えたいことは同じなので、カードの中身をここにまとめている。
 *
 * カード自体（`AuthCard`）は画面側が用意する。
 * 初回セットアップでは 1 枚のカードの中で段階が切り替わるのに対し、
 * あとから勧める画面ではカードごとこの内容になるため。
 */
export function PasskeyRegistrationStep({ onDone }: Readonly<PasskeyRegistrationStepProps>) {
  const [pending, setPending] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** パスキーを登録する。 */
  const registerPasskey = async () => {
    setPending(true);
    setErrorMessage(null);

    // 名前は付けずに登録する。
    // 「iPhone の Face ID」のような分かりやすい名前は、
    // パスキーの一覧を作るとき（マイページ）に、保存されている
    // 認証器の情報から組み立てる予定のため、ここでは決めない。
    //
    // なお `name` を渡すと、その文字列は保存名になるだけでなく、
    // OS のパスキー保存ダイアログや一覧に出るアカウント名も置き換えてしまう。
    // 渡さなければメールアドレスが使われる（利用者にとってはこちらの方が分かりやすい）。
    const { error } = await authClient.passkey.addPasskey();

    setPending(false);

    if (error) {
      // ダイアログを閉じたのは失敗ではなく「やめる」という操作。
      // 赤いエラーを出すと壊れたように見えるので、黙って元の表示に戻す。
      if (isPasskeyCancelledError(error)) return;

      setErrorMessage(
        toAuthErrorMessage(error, "パスキーを登録できませんでした。もう一度お試しください。"),
      );
      return;
    }

    // パスキーを持っている人にはもう勧めないので、「あとで」の記録は消しておく。
    forgetPasskeyPromptDismissals();
    setRegistered(true);
  };

  /** 登録せずに次へ進む。しばらくは勧めないよう記録しておく。 */
  const skip = () => {
    rememberPasskeyPromptDismissed();
    // 画面が切り替わるまで操作させたくないので、ボタンは押せないままにする。
    setPending(true);
    onDone();
  };

  // 登録できたあとの表示。
  // 「登録しました」だけで終わらせず、次回のログインで何が起きるかまで伝える。
  // パスキーは体験そのものが新しいため、ここが分からないと不安が残る。
  if (registered) {
    return (
      <div className="space-y-5">
        <Alert>
          <AlertDescription>パスキーを登録しました。</AlertDescription>
        </Alert>

        <p className="text-sm text-muted-foreground">
          次回のログインからは、メールを確認しにいかなくても、この端末の顔認証・指紋・画面ロックだけでログインできます。
          パスキーが使えないときは、これまでどおりメールの認証コードでもログインできます。
        </p>

        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => {
            setPending(true);
            onDone();
          }}
          disabled={pending}
        >
          続ける
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {errorMessage && (
        <Alert variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
        <li>メールを確認しにいく手間がなくなります</li>
        <li>パスキーはこの端末の中に保存され、他の人は使えません</li>
        <li>登録したあとも、メールの認証コードでログインできます</li>
      </ul>

      <div className="space-y-2">
        <Button
          type="button"
          size="lg"
          className="w-full"
          onClick={() => void registerPasskey()}
          disabled={pending}
        >
          {pending ? "登録中…" : "パスキーを登録"}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="w-full"
          onClick={skip}
          disabled={pending}
        >
          あとで
        </Button>
      </div>
    </div>
  );
}
