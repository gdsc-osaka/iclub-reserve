import { useCallback, useEffect } from "react";
import { redirect, useNavigate } from "react-router";

import { AuthCard } from "~/components/auth/auth-card";
import {
  PASSKEY_STEP_DESCRIPTION,
  PASSKEY_STEP_TITLE,
  PasskeyRegistrationStep,
} from "~/components/auth/passkey-registration-step";
import { readRedirectTo } from "~/lib/auth/auth-redirect";
import { getAuth } from "~/lib/auth/auth.server";
import { usePasskeySupport } from "~/lib/auth/passkey-support";

import type { Route } from "./+types/passkey.suggest";

export function meta(_: Route.MetaArgs) {
  return [{ title: "パスキーの登録 | iclub-reserve" }];
}

/**
 * すでにパスキーを持っている人には、この画面を見せない。
 *
 * ここで見ているのは「その人が 1 つでも持っているか」であって
 * 「今使っている端末に持っているか」ではない。
 * 厳密には別物だが、2 つ目を勧められるのは煩わしく、
 * 持っていない端末からも QR コード経由でパスキーを使えるため、こう割り切っている。
 *
 * ログインの確認は `app/root.tsx` のミドルウェアが済ませているので、
 * ここまで来た時点でログイン済みであることは保証されている。
 */
export async function loader({ request }: Route.LoaderArgs) {
  const redirectTo = readRedirectTo(request);

  const passkeys = await getAuth().api.listPasskeys({ headers: request.headers });
  if (passkeys.length > 0) throw redirect(redirectTo);

  return { redirectTo };
}

/**
 * パスキーの登録を勧める画面。
 *
 * メールの認証コードでログインした人を、行き先へ送る前に一度だけ通す
 * （ログイン画面が、勧める頃合いかどうかを判断してからここへ送る）。
 *
 * 画面の一部にお知らせを出す形ではなくこの画面を挟んでいるのは、
 * このアプリにまだ共通のヘッダーなどがなく、お知らせを置く場所がないため。
 * 加えて、作業の途中で割り込まずに済むという利点もある。
 *
 * ログインはそう頻繁にはしないので、この画面だけでは「定期的に勧める」にはならない。
 * 「あとで」を選ばれてからしばらく勧めない仕組み（`passkey-prompt`）と
 * 組み合わせることで、たまに勧められる形にしている。
 */
export default function PasskeySuggest({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  // パスキーの登録を終えた、または見送ったあとに進むページ。
  const { redirectTo } = loaderData;
  const { status, canRegisterOnThisDevice } = usePasskeySupport();

  const leave = useCallback(() => {
    void navigate(redirectTo, { replace: true });
  }, [navigate, redirectTo]);

  // この端末にパスキーを保存できないなら、勧めても登録できない。
  // 通常はログイン画面が判定してからここへ送るので通らないが、
  // この URL を直接開かれたときのために、素通りできるようにしておく。
  useEffect(() => {
    if (status === "unknown" || canRegisterOnThisDevice) return;

    leave();
  }, [status, canRegisterOnThisDevice, leave]);

  // 判定が終わるまでは何も出さない。
  // サーバー側での描画と食い違うと React が警告を出すため、
  // ブラウザでしか分からないことを画面に反映するのは判定後にする。
  if (status === "unknown" || !canRegisterOnThisDevice) return null;

  return (
    <AuthCard title={PASSKEY_STEP_TITLE} description={PASSKEY_STEP_DESCRIPTION}>
      <PasskeyRegistrationStep onDone={leave} />
    </AuthCard>
  );
}
