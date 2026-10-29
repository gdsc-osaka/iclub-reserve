import { tracing } from "cloudflare:workers";

import {
  setAuthTraceAttributes,
  setQueueTraceAttributes,
  setScheduledTraceAttributes,
  type AuthTraceData,
} from "./trace-context";

/**
 * 認証コンテキスト（ユーザー・セッション識別子）をアクティブスパンに付与する。
 */
export const attachAuthTraceContext = (auth: AuthTraceData | null): void => {
  setAuthTraceAttributes(tracing.getActiveSpan(), auth);
};

/**
 * 定期処理（Cron Triggers）の実行スケジュール情報をアクティブスパンに付与する。
 */
export const attachScheduledTraceContext = (cron: string): void => {
  setScheduledTraceAttributes(tracing.getActiveSpan(), cron);
};

/**
 * キュー処理のコンテキスト情報（キュー名、バッチサイズ）をアクティブスパンに付与する。
 */
export const attachQueueTraceContext = (queue: {
  readonly name: string;
  readonly batchSize: number;
}): void => {
  setQueueTraceAttributes(tracing.getActiveSpan(), queue);
};
