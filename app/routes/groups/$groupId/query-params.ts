/**
 * 団体管理画面（SCR-007）の URL クエリパラメータから操作履歴のページ番号を解析する純粋関数。
 *
 * 整数で 1 以上ならその値、それ以外（無い・数字でない・0 以下・小数）は 1 を返す。
 */
export const parseHistoryPage = (input: Request | URLSearchParams | string): number => {
  let searchParams: URLSearchParams;
  if (input instanceof Request) {
    searchParams = new URL(input.url).searchParams;
  } else if (input instanceof URLSearchParams) {
    searchParams = input;
  } else {
    searchParams = new URLSearchParams(input);
  }

  const raw = searchParams.get("historyPage");
  if (raw === null) {
    return 1;
  }

  const trimmed = raw.trim();
  // 1 以上の整数表現（先頭 1-9 かつ数字のみ）かどうかを判定し、小数や負数、0、英字を除外する
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return 1;
  }

  const num = Number(trimmed);
  return Number.isSafeInteger(num) ? num : 1;
};
