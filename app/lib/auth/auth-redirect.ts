/** ログイン後に元のページへ戻すため、遷移先を伝えるクエリパラメータ名。 */
export const REDIRECT_TO_PARAM = "redirectTo";

/** ログイン・新規登録の画面。 */
export const LOGIN_PATH = "/login";

/** 初回セットアップ（お名前の登録）の画面。 */
export const WELCOME_PATH = "/welcome";

/**
 * パスキーの登録を勧める画面。
 *
 * メールの認証コードでログインした人を、行き先へ送る前に一度だけ通す。
 * ログインが必要な画面なので `PUBLIC_PATHS` には入れない。
 */
export const PASSKEY_SUGGEST_PATH = "/passkey/suggest";

/** 遷移先の指定がないときに送るページ。 */
const DEFAULT_REDIRECT_TO = "/";

/**
 * ログインしていなくても開ける画面（完全一致で判定する）。
 *
 * このアプリは「ここに挙げた画面以外はすべてログインが必要」という方針で、
 * `app/root.tsx` のミドルウェアがまとめて入口を守っている。
 * 新しくログイン不要の画面を作るときだけ、ここに追記すること。
 *
 * `WELCOME_PATH`（お名前の登録）はログインの途中に通る画面なので、
 * ミドルウェアでは素通しし、その画面自身のローダーでログイン状態を確かめている。
 */
const PUBLIC_PATHS: ReadonlySet<string> = new Set([LOGIN_PATH, WELCOME_PATH]);

/**
 * ログインしていなくても開けるパスの接頭辞（前方一致で判定する）。
 *
 * Better Auth の API は「ログインするための API」なので、ログイン必須にはできない。
 * 個々のエンドポイントの保護は Better Auth 側が行う。
 */
const PUBLIC_PATH_PREFIXES: readonly string[] = ["/api/auth/"];

/** ログインしていなくても開ける画面かどうかを判定する。 */
export const isPublicPath = (pathname: string): boolean =>
  PUBLIC_PATHS.has(pathname) || PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));

/**
 * ログイン後の遷移先として安全な URL だけを通す。
 *
 * クエリパラメータの値をそのまま遷移先にすると、外部サイトへ誘導される
 * （オープンリダイレクト）恐れがある。そのため自サイト内のパス
 * （"/" で始まり "//" では始まらない）だけを許可し、それ以外はトップページに送る。
 */
export const toSafeRedirectTo = (value: string | null): string =>
  value && value.startsWith("/") && !value.startsWith("//") ? value : DEFAULT_REDIRECT_TO;

/**
 * 今リクエストされているページのパス（クエリパラメータを除く）を返す。
 *
 * React Router はクライアント側の画面遷移では "/foo.data?_routes=..." という
 * 内部向けの URL でローダーを呼ぶ。`request.url` はその形のままなので、
 * どの画面へのアクセスなのかを判定するにはこの関数で元の形に戻す。
 */
export const toCurrentPathname = (request: Request): string => {
  const { pathname } = new URL(request.url);

  // 親ルートだけを読み込むときは "/_.data"、それ以外は "/foo.data" になる。
  return pathname.endsWith("/_.data")
    ? pathname.replace(/_\.data$/, "")
    : pathname.replace(/\.data$/, "");
};

/**
 * リクエストの `?redirectTo=...` から、ログイン後の遷移先を取り出す。
 *
 * 今いる画面そのものが指定されていたときは、代わりにトップページを返す。
 * ログインの途中に挟む画面（お名前の登録・パスキーの登録）は、
 * 用が済むとこの遷移先へ進む。そこに自分自身が入っていると、
 * 何度進んでも同じ画面に戻ってくる堂々巡りになってしまう。
 *
 * この指定は作為的なものだけではなく、ログインしていない状態で
 * これらの画面を直接開くと自然に発生する
 * （ログイン画面へ送るときに、元の画面として引き継がれるため）。
 */
export const readRedirectTo = (request: Request): string => {
  const redirectTo = toSafeRedirectTo(new URL(request.url).searchParams.get(REDIRECT_TO_PARAM));
  // 遷移先はクエリパラメータを含むことがあるので、画面の比較はパスだけで行う。
  const redirectToPathname = redirectTo.split("?")[0];

  return redirectToPathname === toCurrentPathname(request) ? DEFAULT_REDIRECT_TO : redirectTo;
};

/**
 * 今リクエストされているページを、ログイン後の戻り先として使える形で返す。
 *
 * `toCurrentPathname` と違い、検索条件などのクエリパラメータは残す
 * （ログインを終えたあと、同じ表示状態に戻したいため）。
 */
export const toCurrentPath = (request: Request): string => {
  const url = new URL(request.url);
  const pathname = toCurrentPathname(request);

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
