/**
 * Cookie ヘッダーから、指定した名前の値を取り出す。
 *
 * 該当する cookie が無いときや、デコードに失敗したときは null を返す。
 */
export const findCookieValue = (cookieHeader: string | null, name: string): string | null => {
  if (!cookieHeader) return null;

  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator === -1) continue;
    if (entry.slice(0, separator).trim() !== name) continue;

    const value = entry.slice(separator + 1).trim();

    try {
      return decodeURIComponent(value);
    } catch {
      // 「%」だけのような壊れた値だと decodeURIComponent は例外を投げる。
      // ここで受け止めないとローダーごと落ちて、画面が開けなくなってしまう。
      // なかったことにして先へ進める。
      return null;
    }
  }

  return null;
};
