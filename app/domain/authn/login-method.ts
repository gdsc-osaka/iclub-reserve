/**
 * ログイン方法の並び順。
 *
 * このアプリにはメールの認証コードとパスキーの 2 つのログイン方法がある。
 * どちらを主に使うかは人それぞれなので、毎回同じ順で並べていると
 * 「いつも使っている方」を毎回探すことになる。
 *
 * そこで、前回そのブラウザで使った方法を先頭に出す。
 * どの方法を使うかは端末ごとの好みなので（自分のスマートフォンではパスキー、
 * 共用のパソコンではメール、といった使い分けが自然に起きる）、
 * この記録はサーバーではなくブラウザ側に持つ。
 * 保存の方法は `app/lib/auth/last-login-method-cookie.ts` を参照。
 */

/**
 * ログイン方法の一覧。前回の記録がないときの並び順でもある。
 *
 * パスキーをまだ持っていない人の方が多いため、
 * 既定では誰でも使えるメールの認証コードを先に出す。
 */
export const LOGIN_METHODS = ["email-otp", "passkey"] as const;

/** ログイン方法。 */
export type LoginMethod = (typeof LOGIN_METHODS)[number];

/**
 * ブラウザに保存されていた文字列を、ログイン方法に戻す。
 *
 * 保存した値は利用者が書き換えられるうえ、
 * 昔のバージョンが書いた別の値が残っていることもある。
 * 知らない値はすべて「記録なし」（null）として扱い、既定の並び順に戻す。
 *
 * @param raw 保存されていた文字列。何もなければ null
 */
export const parseLoginMethod = (raw: string | null): LoginMethod | null =>
  LOGIN_METHODS.find((method) => method === raw) ?? null;

/**
 * 前回使った方法を先頭にした並び順を返す。
 *
 * 先頭以外の並びは既定のまま変えない。
 * 使うたびに順番が入れ替わると、画面の形が毎回変わって覚えられないため。
 *
 * @param lastUsed 前回このブラウザで使った方法。記録がなければ null
 */
export const toLoginMethodOrder = (lastUsed: LoginMethod | null): readonly LoginMethod[] =>
  lastUsed === null
    ? LOGIN_METHODS
    : [lastUsed, ...LOGIN_METHODS.filter((method) => method !== lastUsed)];
