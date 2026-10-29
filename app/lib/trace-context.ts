/**
 * Cloudflare Workers Issues / Tracing 向けのスパン属性付与を行う純粋関数群。
 *
 * Vitest（`pnpm test`）実行時は `@cloudflare/vite-plugin` を通さないため、
 * このファイルでは `cloudflare:workers` を import しない（`app/lib/app-url.ts` と同じ分離パターン）。
 * `cloudflare:workers` から `tracing.getActiveSpan()` を取得する処理は、
 * `trace-context.server.ts` に切り出してある。
 */

/**
 * アクティブスパンへ設定可能なスパンの最小インターフェース。
 *
 * Cloudflare Workers の `Span` または OpenTelemetry の Span 互換オブジェクトを受け付ける。
 */
export interface SpanLike {
  setAttribute(key: string, value: boolean | number | string): unknown;
}

/**
 * 認証トレースに付与するユーザーおよびセッション情報。
 */
export interface AuthTraceData {
  readonly user: { readonly id: string };
  readonly session: { readonly id: string };
}

/**
 * 認証済みのユーザー・セッション識別子をスパン属性に設定する。
 *
 * メールアドレス・氏名などの個人情報やセッショントークンは含めず、識別子のみを付与する（ADR-004 決定 9）。
 */
export const setAuthTraceAttributes = (
  span: SpanLike | undefined,
  auth: AuthTraceData | null,
): void => {
  if (!span || !auth) return;

  span.setAttribute("user.id", auth.user.id);
  span.setAttribute("session.id", auth.session.id);
};

/**
 * 定期処理（Cron Triggers）の実行スケジュール情報をスパン属性に設定する。
 */
export const setScheduledTraceAttributes = (span: SpanLike | undefined, cron: string): void => {
  span?.setAttribute("cron.schedule", cron);
};

/**
 * キュー処理の実行コンテキスト情報をスパン属性に設定する。
 */
export const setQueueTraceAttributes = (
  span: SpanLike | undefined,
  queue: { readonly name: string; readonly batchSize: number },
): void => {
  span?.setAttribute("queue.name", queue.name);
  span?.setAttribute("queue.batch_size", queue.batchSize);
};
