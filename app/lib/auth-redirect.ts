/** ログイン後に元のページへ戻すため、遷移先を伝えるクエリパラメータ名。 */
export const REDIRECT_TO_PARAM = "redirectTo";

/** ログイン・新規登録の画面。 */
export const LOGIN_PATH = "/login";

/** 初回セットアップ（お名前の登録）の画面。 */
export const WELCOME_PATH = "/welcome";

/** 遷移先の指定がないときに送るページ。 */
const DEFAULT_REDIRECT_TO = "/";

/**
 * ログイン後の遷移先として安全な URL だけを通す。
 *
 * クエリパラメータの値をそのまま遷移先にすると、外部サイトへ誘導される
 * （オープンリダイレクト）恐れがある。そのため自サイト内のパス
 * （"/" で始まり "//" では始まらない）だけを許可し、それ以外はトップページに送る。
 */
export const toSafeRedirectTo = (value: string | null): string =>
  value && value.startsWith("/") && !value.startsWith("//") ? value : DEFAULT_REDIRECT_TO;

/** リクエストの `?redirectTo=...` から、ログイン後の遷移先を取り出す。 */
export const readRedirectTo = (request: Request): string =>
  toSafeRedirectTo(new URL(request.url).searchParams.get(REDIRECT_TO_PARAM));

/**
 * 今リクエストされているページのパスを、ログイン後の戻り先として使える形で返す。
 *
 * React Router はクライアント側の画面遷移では "/foo.data?_routes=..." という
 * 内部向けの URL でローダーを呼ぶ。そのまま戻り先にすると存在しないパスへ
 * 飛ばしてしまうため、内部向けの部分を取り除いてから返す。
 */
export const toCurrentPath = (request: Request): string => {
  const url = new URL(request.url);
  // 親ルートだけを読み込むときは "/_.data"、それ以外は "/foo.data" になる。
  const pathname = url.pathname.endsWith("/_.data")
    ? url.pathname.replace(/_\.data$/, "")
    : url.pathname.replace(/\.data$/, "");

  url.searchParams.delete("_routes");
  const search = url.searchParams.toString();

  return search === "" ? pathname : `${pathname}?${search}`;
};

/**
 * ログイン画面などへ送るときに、戻り先を引き継いだ URL を作る。
 *
 * 戻り先がトップページ（既定）のときはパラメータを付けず、URL を短く保つ。
 *
 * @param path 送り先の画面（`LOGIN_PATH` など）
 * @param redirectTo その画面を終えたあとに戻すページ
 */
export const withRedirectTo = (path: string, redirectTo: string | null): string => {
  const safeRedirectTo = toSafeRedirectTo(redirectTo);
  if (safeRedirectTo === DEFAULT_REDIRECT_TO) return path;

  return `${path}?${new URLSearchParams({ [REDIRECT_TO_PARAM]: safeRedirectTo }).toString()}`;
};
