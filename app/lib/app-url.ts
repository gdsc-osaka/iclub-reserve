/**
 * 設定値として受け取った URL から、メールに載せてよい origin（`https://example.com` の形）を取り出す。
 *
 * 読めない値、および http / https 以外のスキームは受け付けずに null を返す。
 * `URL.canParse` は `mailto:` や `ftp:` も真にするうえ、それらの `origin` は
 * 文字列 `"null"` になるため、素通しすると `null/invitations/xxx` のような
 * 壊れたリンクがそのままメールに載ってしまう。
 *
 * `cloudflare:workers` を読まない純粋な関数として切り出してある。
 * 環境変数の読み出しは app-url.server.ts の担当で、判定はここで検証できるようにするため。
 */
export const toMailableOrigin = (value: string | null | undefined): string | null => {
  if (typeof value !== "string" || !URL.canParse(value)) return null;

  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  return url.origin;
};
