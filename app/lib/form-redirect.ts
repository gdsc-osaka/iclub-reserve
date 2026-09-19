/**
 * フォームの送信後に、いま見ていた画面へ戻すためのパスを組み立てる。
 *
 * React Router の Single Fetch では、ブラウザで JavaScript が動いているとき、
 * `<Form method="post">` の送信先が `/reservations.data` のような
 * データ用の URL になる。アクションの中で受け取る `request.url` もその URL なので、
 * `new URL(request.url).pathname` をそのままリダイレクト先にすると
 * `/reservations.data` へ遷移してしまい、「ページが見つかりません」が出る。
 *
 * そのため、末尾の `.data` と React Router が内部で付けるクエリ（`_routes`）を
 * 落としてから使う。JavaScript が動いていないときは `.data` が付かないので、
 * どちらの経路でも同じパスに戻る。
 *
 * 絞り込みのクエリ（`?status=provisional` など）は残す。操作のたびに
 * 絞り込みが外れると、一覧を見ていた場所を毎回探し直すことになる。
 */
export const toSamePagePath = (request: Request): string => {
  const url = new URL(request.url);

  const DATA_SUFFIX = ".data";
  const pathname = url.pathname.endsWith(DATA_SUFFIX)
    ? url.pathname.slice(0, -DATA_SUFFIX.length)
    : url.pathname;

  const params = new URLSearchParams(url.search);
  // React Router が Single Fetch のために付けるクエリ。画面の状態ではないので落とす
  params.delete("_routes");
  const search = params.toString();

  /*
   * ルート直下の画面（index ルート）のデータ URL は `/_root.data` になる。
   * `.data` を外しただけでは `/_root` という存在しないパスになってしまうので、
   * トップページに戻す。
   */
  const safePathname = pathname === "" || pathname === "/_root" ? "/" : pathname;

  return search === "" ? safePathname : `${safePathname}?${search}`;
};
