import type { ResultAsync } from "neverthrow";
import type { QueryError } from "../error";

/**
 * 事務局のダッシュボード「承認待ちの予約」に並ぶ仮予約 1 件分（SCR-022 / UC-006）。
 */
export interface StaffPendingReservationItem {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly facilityId: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly headCount: number;
  /** 申請日 */
  readonly createdAt: Date;
  /** 同じ施設・時間帯に承認済みの予約があるか。あれば承認できない（COND-001） */
  readonly hasApprovedOverlap: boolean;
  /** 同じ施設・時間帯にほかの仮予約があるか。承認されるのはどちらか一方になる */
  readonly hasProvisionalOverlap: boolean;
}

export interface StaffPendingReservationsQuery {
  /**
   * 開始日時が `now` より後の仮予約を、開始日時の近い順にすべて返す。
   *
   * 件数（総数と、利用日まで 7 日を切っている数）も数えるので、ここでは件数を絞らない。
   */
  findUpcomingProvisional(
    now: Date,
  ): ResultAsync<readonly StaffPendingReservationItem[], QueryError>;
}
