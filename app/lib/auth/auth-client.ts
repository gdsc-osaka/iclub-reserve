import { passkeyClient } from "@better-auth/passkey/client";
import { emailOTPClient, inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { getAuth } from "./auth.server";

/**
 * ブラウザ側から Better Auth を呼び出すためのクライアント。
 *
 * emailOTPClient を登録すると、サーバー側の emailOTP プラグインに対応する
 * `authClient.emailOtp.sendVerificationOtp`（認証コードのメール送信）と
 * `authClient.signIn.emailOtp`（認証コードでのログイン）が使えるようになる。
 *
 * 同じく passkeyClient を登録すると、サーバー側の passkey プラグインに対応する
 * `authClient.signIn.passkey`（パスキーでのログイン）と
 * `authClient.passkey.addPasskey`（パスキーの登録）が使えるようになる。
 *
 * inferAdditionalFields は、サーバーで `user` に足した列（`is_staff`・`terms_version` など）を
 * ログインの応答の型にも載せるためのもの。ログイン直後に本登録が済んでいるか
 * （利用規約に同意済みか）をブラウザ側で判定するのに使う。
 * サーバーの設定は型として読むだけなので、ブラウザ向けの成果物には入らない。
 */
export const authClient = createAuthClient({
  plugins: [emailOTPClient(), passkeyClient(), inferAdditionalFields<ReturnType<typeof getAuth>>()],
});
