import { isCountedNavPath } from "~/components/layout/nav-items";

export interface ShouldRecountNavCountsArgs {
  readonly currentUrl: URL;
  readonly nextUrl: URL;
  readonly formMethod?: string;
}

/**
 * 外枠（app-layout）の loader を再実行してナビゲーションの件数を数え直すべきかどうかを判定する。
 *
 * 毎回の画面遷移で DB を叩き直さないよう、次の 3 つの場面に限って再検証する。
 * 1. GET 以外の送信のあと（予約の申請・承認・メッセージ送信などのデータ更新後）
 * 2. 件数を持つナビ項目（ダッシュボード・予約の承認・団体の管理）を開いたとき
 * 3. 同じ URL の読み直し（アカウント設定で氏名・メールアドレスを変えた後の `revalidate()` 等で、
 *    外枠の loader が返すユーザー情報を最新にするために必須）
 */
export const shouldRecountNavCounts = ({
  currentUrl,
  nextUrl,
  formMethod,
}: ShouldRecountNavCountsArgs): boolean => {
  // 1. GET 以外の送信のあとは、件数が変わりうる操作の後なので数え直す
  if (formMethod !== undefined && formMethod.toUpperCase() !== "GET") {
    return true;
  }

  // 2. 件数を持つタブを開いたときは、最新の件数を表示するため数え直す
  if (isCountedNavPath(nextUrl.pathname)) {
    return true;
  }

  /*
   * 3. 同じ URL の読み直し（`useRevalidator().revalidate()`）。
   * アカウント設定（app/routes/account/route.tsx）は氏名・メールアドレスを変更した後に
   * `revalidate()` で外枠の loader を再実行し、サイドバー下やヘッダーの氏名・メールアドレスを更新している。
   * ここで false を返すと変更後も古い氏名が出たままになるため、必ず true を返す。
   */
  if (currentUrl.href === nextUrl.href) {
    return true;
  }

  // それ以外（件数を持たない画面への移動、GET フォームによる絞り込み等）は再実行しない
  return false;
};

/**
 * ダッシュボードの件数の内訳を足し合わせる。
 *
 * 1 つでも読めなかった内訳（null）がある場合は、少なく数えた不正確な値を
 * 利用者に見せないよう、全体を null（件数非表示）とする。
 */
export const sumCounts = (parts: readonly (number | null)[]): number | null => {
  let total = 0;
  for (const part of parts) {
    if (part === null) {
      return null;
    }
    total += part;
  }
  return total;
};
