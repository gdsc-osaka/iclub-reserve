/**
 * カレンダー同期タスクの状態。
 *
 * 成功した行は削除されるため、テーブル内に残るのは処理待ち・処理中・諦めたタスクのみとなる。
 */
export const CalendarSyncStatus = {
  /** 処理待ち。next_attempt_at を過ぎたら処理してよい */
  Pending: "pending",
  /** 処理中。現在同期処理が進行中 */
  Processing: "processing",
  /** 諦めた。終端。再試行回数上限または恒久エラー */
  Dead: "dead",
} as const;
export type CalendarSyncStatus = (typeof CalendarSyncStatus)[keyof typeof CalendarSyncStatus];
