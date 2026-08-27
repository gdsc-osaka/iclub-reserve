import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * ブラウザ側から Better Auth を呼び出すためのクライアント。
 *
 * emailOTPClient を登録すると、サーバー側の emailOTP プラグインに対応する
 * `authClient.emailOtp.sendVerificationOtp`（認証コードのメール送信）と
 * `authClient.signIn.emailOtp`（認証コードでのログイン）が使えるようになる。
 */
export const authClient = createAuthClient({
  plugins: [emailOTPClient()],
});
