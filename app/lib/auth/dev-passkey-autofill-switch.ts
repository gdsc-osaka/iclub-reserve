/**
 * 開発サーバー（`pnpm run dev`）でだけ効く、パスキーのオートフィルを止めるスイッチのキー。
 *
 * 他のアプリと同じ localStorage を共有することがあるため、アプリ名で始まる名前にしている。
 * 値を `"off"` にすると止まる。ローカルでログインするスキル（`.agents/skills/local-login/SKILL.md`）が入れる。
 */
export const DEV_PASSKEY_AUTOFILL_STORAGE_KEY = "iclub-reserve.dev.passkey-autofill";

/**
 * このブラウザで、パスキーのオートフィルが止められているかどうか。
 *
 * ログイン画面は、オートフィル（条件付き UI）に対応したブラウザだと、開いただけでパスキーの問い合わせを始める。
 * Claude Code の内蔵ブラウザには入力欄の候補を出す仕組みが無く、この問い合わせが
 * Windows の「パスキーを使用してサインインします」というダイアログになって、画面の最前面に出てしまう。
 * コーディングエージェントが裏で画面を確かめるたびに、人の作業が遮られる。
 *
 * そこで、エージェントが使うブラウザでだけ、localStorage に印を入れて止められるようにしている。
 * 印はブラウザごとなので、人が自分のブラウザで確かめるときは今までどおりオートフィルが出る。
 *
 * ビルドすると `import.meta.env.DEV` が false に置き換わるため、
 * 本番・プレビュー・E2E のアプリでは、このスイッチは無いのと同じになる。
 */
export const isPasskeyAutofillTurnedOffForDev = (): boolean => {
  if (!import.meta.env.DEV) return false;

  try {
    return localStorage.getItem(DEV_PASSKEY_AUTOFILL_STORAGE_KEY) === "off";
  } catch {
    // localStorage を読めない環境では、止めない側（いつもの動き）に倒す。
    return false;
  }
};
