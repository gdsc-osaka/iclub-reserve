/**
 * プレビュー環境で追加で信頼する origin のパターンを作る。
 *
 * Workers Builds は、プレビュー環境をブランチごとの URL でも公開する。形は
 * `<ブランチ名>-<Worker 名>.<サブドメイン>.workers.dev` で、代表 URL
 * （`<Worker 名>.<サブドメイン>.workers.dev`）のホスト名の前にブランチ名が付いたものになる。
 *
 * 一方 Better Auth は CSRF 対策として、リクエストの Origin が信頼した一覧に含まれるかを
 * 検査する。既定で信頼されるのは baseURL（= BETTER_AUTH_URL）の origin だけなので、
 * ブランチごとの URL から API を呼ぶと 403 INVALID_ORIGIN で弾かれてしまう。
 * BETTER_AUTH_URL は環境ごとに 1 つしか持てず、ブランチごとに変えることもできない。
 *
 * そこで「代表 URL のホスト名に前置きが付いた形」だけをまとめて信頼する。
 * Better Auth のワイルドカードは `/` だけを区切りとして扱うため、`*` はブランチ名に
 * 含まれる `-` にも `.` にも一致する。ホスト名の途中で止まらないので、`*-` の後ろには
 * 代表 URL のホスト名を丸ごと置き、まったく別のドメインまで信頼が広がらないようにしている。
 *
 * baseURL が URL として読めないときは何も足さない。Better Auth CLI は
 * `cloudflare:workers` を差し替えるため、スキーマ生成の最中は
 * BETTER_AUTH_URL が文字列にならない（auth.server.ts の `toOrigin` と同じ事情）。
 *
 * @param baseURL BETTER_AUTH_URL に入っている、その環境の代表 URL
 */
export const buildPreviewTrustedOrigins = (baseURL: string | undefined): string[] => {
  if (typeof baseURL !== "string" || !URL.canParse(baseURL)) return [];

  const { protocol, host } = new URL(baseURL);

  return [`${protocol}//*-${host}`];
};
