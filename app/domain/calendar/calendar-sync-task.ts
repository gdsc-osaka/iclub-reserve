import type { ResultAsync } from "neverthrow";
import type { BaseError } from "../error";
import type { CalendarError } from "./calendar-client";
import type { CalendarSyncTaskDraft } from "./calendar-event";

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

/**
 * 取り出されたカレンダー同期タスク。
 */
export interface CalendarSyncTask {
  readonly id: number;
  readonly reservationId: string;
  readonly previousFacilityId: string | null;
  readonly attemptCount: number;
}

export const CalendarSyncTaskErrorCode = {
  DatabaseError: "DATABASE_ERROR",
} as const;
export type CalendarSyncTaskErrorCode =
  (typeof CalendarSyncTaskErrorCode)[keyof typeof CalendarSyncTaskErrorCode];

export interface CalendarSyncTaskError extends BaseError {
  readonly code: CalendarSyncTaskErrorCode;
}

/**
 * 最大試行回数。attempt_count がこの値以上（＝6回目の試行）で失敗したタスクは dead になる。
 */
export const CALENDAR_SYNC_MAX_ATTEMPTS = 5;

/**
 * 一過性エラー時の再試行遅延（ミリ秒）を計算する純粋関数。
 *
 * delay = min(30 秒 × 2^attempt_count, 1 時間)
 */
export const calculateCalendarSyncBackoffDelayMs = (attemptCount: number): number =>
  Math.min(30_000 * 2 ** attemptCount, 3_600_000);

/**
 * カレンダー同期タスク（Transactional Outbox）を操作するポート。
 */
export interface CalendarSyncTasks {
  /**
   * 処理すべきタスクを上限件数まで取得し、status を 'processing' に進めて返す。
   */
  claimDue(args: {
    readonly now: Date;
    readonly limit: number;
  }): ResultAsync<readonly CalendarSyncTask[], CalendarSyncTaskError>;

  /**
   * 正常に処理が完了したタスクを削除する。
   */
  complete(ids: readonly number[]): ResultAsync<void, CalendarSyncTaskError>;

  /**
   * 失敗したタスクを更新する（再試行可能なら backoff して pending、不可または回数超過なら dead）。
   */
  fail(args: {
    readonly ids: readonly number[];
    readonly error: CalendarError;
    readonly now: Date;
  }): ResultAsync<void, CalendarSyncTaskError>;

  /**
   * 日次の突き合わせで見つけた差分を、処理待ちのタスクとして積む。
   *
   * 業務データの書き込みを伴わないので、予約や施設のリポジトリで積むときと違って条件（guard）は付けない。
   */
  enqueue(args: {
    readonly drafts: readonly CalendarSyncTaskDraft[];
    readonly now: Date;
  }): ResultAsync<void, CalendarSyncTaskError>;
}
