import { findCookieValue } from "~/lib/cookie";

import { type AppArea, parseAppArea } from "~/lib/app-area";

/**
 * 前回使っていた画面の領域を覚えておくための cookie の名前（ADR-016 決定 3）。
 *
 * 他のアプリと同じドメインに置かれることがあるため、
 * アプリ名で始まる名前にして衝突を避けている。
 *
 * この Cookie はナビの出し方とログイン後の行き先（ADR-016 決定 4）にしか使わない。
 * 権限の判定や操作者の立場には絶対に使わない（COND-030 の (4)）。
 */
const COOKIE_NAME = "iclub-reserve.last-area";

/** 記録を保つ期間（1 年）。 */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * リクエストから、前回このブラウザで開いていた領域を取り出す。
 *
 * ローダーから呼ぶ。記録がなければ null。
 */
export const readLastArea = (request: Request): AppArea | null =>
  parseAppArea(findCookieValue(request.headers.get("Cookie"), COOKIE_NAME));

/**
 * 今回開いた領域を、このブラウザに覚えさせる。
 *
 * ブラウザでしか動かないので、ローダーなどサーバー側から呼ばないこと。
 * cookie を拒否している環境では黙って無視される（例外は出ない）。
 */
export const rememberLastArea = (area: AppArea): void => {
  // https でないと Secure 付きの cookie は保存できないため、開発中は付けない。
  const secure = location.protocol === "https:" ? "; Secure" : "";

  // SameSite=Lax は、他サイトから貼られたリンクで開いたときにも届く一番緩い安全側の指定。
  document.cookie = `${COOKIE_NAME}=${area}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
};
