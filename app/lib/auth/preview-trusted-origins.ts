/**
 * プレビュー環境で追加で信頼する origin を作る。
 *
 * 派生ブランチは Worker Previews として、代表 URL（develop）のサブドメインで公開される
 * （ADR-006）。形は `<ブランチ名>.<代表 URL のホスト名>` で、デプロイごとに固定の URL は
 * `<デプロイ ID>-<ブランチ名>.<代表 URL のホスト名>` になる。
 *
 * 返す値は 2 種類ある。
 *
 * 1. 代表 URL のサブドメインをまとめて許すパターン（CSRF の検査用）
 *
 *    Better Auth は CSRF 対策として、リクエストの Origin が信頼した一覧に含まれるかを
 *    検査する。既定で信頼されるのは baseURL（= BETTER_AUTH_URL）の origin だけなので、
 *    ブランチごとの URL から API を呼ぶと 403 INVALID_ORIGIN で弾かれてしまう。
 *    BETTER_AUTH_URL は環境ごとに 1 つしか持てず、ブランチごとに変えることもできない。
 *
 *    Better Auth のワイルドカードは `/` だけを区切りとして扱うため、`*` はブランチ名に
 *    含まれる `-` にも `.` にも一致する。ホスト名の途中で止まらないので、`*.` の後ろには
 *    代表 URL のホスト名を丸ごと置き、まったく別のドメインまで信頼が広がらないようにしている。
 *
 * 2. リクエストを受けたブランチ自身の origin（パスキーの検証用）
 *
 *    passkey プラグインは `origin` を指定しないとき、baseURL の origin に加えて、
 *    ブラウザが報告した origin を `trustedOrigins` に**完全一致で**載っている場合だけ受け入れる。
 *    1 のワイルドカードは数えないので、これが無いとブランチの Preview でパスキーの登録も
 *    ログインも「Failed to verify registration」などで失敗する。
 *
 *    値は Origin ヘッダーではなく、サーバーが受けたリクエストの URL から取る。
 *    検証で通るのは「そのリクエストを受けたブランチ自身の origin」だけになり、
 *    別のブランチの Preview で作られた応答は通らない。
 *    1 のパターンに一致するものだけを足すので、CSRF の検査で信頼する範囲は広がらない。
 *
 * baseURL が URL として読めないときは何も足さない。Better Auth CLI は
 * `cloudflare:workers` を差し替えるため、スキーマ生成の最中は
 * BETTER_AUTH_URL が文字列にならない（auth.server.ts の `toOrigin` と同じ事情）。
 *
 * @param baseURL BETTER_AUTH_URL に入っている、その環境の代表 URL
 * @param requestURL いま処理しているリクエストの URL。Better Auth が起動時に
 *   リクエスト無しで呼ぶこともあるので、省略できる
 */
export const buildPreviewTrustedOrigins = (
  baseURL: string | undefined,
  requestURL?: string,
): string[] => {
  if (typeof baseURL !== "string" || !URL.canParse(baseURL)) return [];

  const base = new URL(baseURL);
  const pattern = `${base.protocol}//*.${base.host}`;
  const branchOrigin = toBranchOrigin(base, requestURL);

  return branchOrigin === undefined ? [pattern] : [pattern, branchOrigin];
};

/**
 * リクエストの URL が代表 URL のサブドメインなら、その origin を返す。
 *
 * スキーム・ポートが代表 URL と同じで、ホスト名が `.<代表 URL のホスト名>` で終わるものだけを
 * サブドメインとみなす。代表 URL そのものは Better Auth が baseURL として信頼済みなので返さない。
 */
const toBranchOrigin = (base: URL, requestURL: string | undefined): string | undefined => {
  if (requestURL === undefined || !URL.canParse(requestURL)) return undefined;

  const url = new URL(requestURL);
  const isSubdomain =
    url.protocol === base.protocol &&
    url.port === base.port &&
    url.hostname.endsWith(`.${base.hostname}`);

  return isSubdomain ? url.origin : undefined;
};
