import { type LoginMethod, parseLoginMethod } from "~/domain/auth/login-method";

/**
 * 前回使ったログイン方法を覚えておくための cookie の名前。
 *
 * 他のアプリと同じドメインに置かれることがあるため、
 * アプリ名で始まる名前にして衝突を避けている。
 */
const COOKIE_NAME = "iclub-reserve.last-login-method";

/** 記録を保つ期間（1 年）。ログインの間隔が空いても忘れないだけの長さにしている。 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * 記録の置き場所として cookie を選んでいる理由。
 *
 * 「前回の方法を先頭に出す」ためには、**最初の描画の時点で**
 * どちらが先かが分かっていなければならない。localStorage はブラウザでしか
 * 読めないので、サーバーは既定の並び順で描くしかなく、
 * 画面が表示されたあとに順番が入れ替わってしまう（レイアウトのずれ）。
 * cookie ならリクエストと一緒にサーバーへ届くので、最初から正しい順番で描ける。
 *
 * cookie もブラウザごとに保存されるため、
 * 「ノート PC での記録がスマートフォンに引き継がれない」点は localStorage と同じ。
 * これは欠点ではなく、パスキーが端末ごとのものである以上むしろ望ましい。
 *
 * 中身はログイン方法の名前だけで、誰のものかは分からない。
 * 読めても書けなくてもログインには影響しない（並び順が既定に戻るだけ）。
 */
const findCookieValue = (cookieHeader: string | null, name: string): string | null => {
  if (!cookieHeader) return null;

  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator === -1) continue;
    if (entry.slice(0, separator).trim() !== name) continue;

    return decodeURIComponent(entry.slice(separator + 1).trim());
  }

  return null;
};

/**
 * リクエストから、前回このブラウザで使ったログイン方法を取り出す。
 *
 * ローダーから呼ぶ。記録がなければ null（＝既定の並び順）。
 */
export const readLastLoginMethod = (request: Request): LoginMethod | null =>
  parseLoginMethod(findCookieValue(request.headers.get("Cookie"), COOKIE_NAME));

/**
 * 今回使ったログイン方法を、このブラウザに覚えさせる。
 *
 * ブラウザでしか動かないので、ローダーなどサーバー側から呼ばないこと。
 * cookie を拒否している環境では黙って無視される（例外は出ない）。
 */
export const rememberLastLoginMethod = (method: LoginMethod): void => {
  // https でないと Secure 付きの cookie は保存できないため、開発中は付けない。
  const secure = location.protocol === "https:" ? "; Secure" : "";

  // SameSite=Lax は、他サイトから貼られたリンクで開いたときにも届く一番緩い安全側の指定。
  document.cookie = `${COOKIE_NAME}=${method}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
};
