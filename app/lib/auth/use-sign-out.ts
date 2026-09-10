import { useState } from "react";
import { useNavigate } from "react-router";

import { authClient } from "./auth-client";
import { LOGIN_PATH } from "./auth-redirect";

/**
 * ログアウトの処理。サイドバーとスマホのメニューの両方から使う。
 *
 * 2 か所に同じ処理を書くと、片方だけ直したときに
 * 「PC ではログアウトできるがスマホではできない」という差が生まれるため、
 * ここにまとめている。
 *
 * ログアウトに失敗しても画面を止めないのは、原因のほとんどが
 * 「セッションがすでに切れている」ケースだから。
 * その場合はログイン画面へ送るのが正しい振る舞いになる。
 */
export const useSignOut = () => {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const signOut = async () => {
    // 二重送信の防止。連打で複数回リクエストが飛ぶのを防ぐ
    if (isSigningOut) return;
    setIsSigningOut(true);

    await authClient.signOut();
    await navigate(LOGIN_PATH, { replace: true });
  };

  return { signOut, isSigningOut };
};
