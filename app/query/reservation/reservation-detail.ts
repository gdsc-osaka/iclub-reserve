import type { ResultAsync } from "neverthrow";

import type { ReservationStatus } from "~/domain/reservation";
import type { QueryError } from "../error";

/**
 * DB から読んだままの予約詳細の 1 件。**画面へそのまま渡してはいけない。**
 *
 * 団体の ID は「見ている人が所属している団体かどうか」を判定するために使い、
 * 画面へ渡す {@link ReservationDetailView} では落とす（COND-008）。
 * 画面側で隠すのでは、通信の中身を見れば ID が分かってしまう。
 *
 * 落とし忘れを型で防ぐために、画面へ渡す型とはわざと別に分けてある（ADR-001）。
 */
export interface ReservationDetailRow {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
  readonly statusReason: string | null;
  readonly headCount: number;
  readonly note: string | null;
  readonly createdByName: string | null;
  readonly createdAt: Date;
  /** 同一施設・同一時間帯に承認済みの予約が存在するかどうか（COND-001） */
  readonly hasApprovedOverlap: boolean;
  /**
   * 同一施設・同一時間帯に他の仮予約が存在するかどうか。
   *
   * 承認を止める条件ではない（COND-001 が見るのは承認済みだけ）。
   * 申請が競合していることを、承認する人と申請した団体の両方に知らせるために使う。
   */
  readonly hasProvisionalOverlap: boolean;
}

/**
 * 他団体の人にも見せてよい範囲の予約（COND-008 の 2 段目）。
 *
 * 団体の ID を持たせていないのは、COND-008 が他団体に見せてよいとしているのが
 * 団体「名」までのため。画面は団体名しか出さないので ID は要らない。
 * 使わない識別子を載せると、通信の中身を見れば団体を特定できてしまう。
 */
export interface ReservationDetailSummary {
  readonly id: string;
  readonly groupName: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
}

/**
 * 自団体のメンバーと事務局に見せる全項目の予約（COND-008 の 1 段目）。
 *
 * {@link ReservationDetailSummary} の項目に加え、使用人数・備考・却下/キャンセル理由・
 * 申請者・申請日時・重なり判定フラグを含む。
 */
export interface ReservationDetailFull extends ReservationDetailSummary {
  readonly headCount: number;
  readonly note: string | null;
  readonly statusReason: string | null;
  readonly createdByName: string | null;
  readonly createdAt: Date;
  /** 同一施設・同一時間帯に承認済みの予約が存在するかどうか（COND-001） */
  readonly hasApprovedOverlap: boolean;
  /** 同一施設・同一時間帯に他の仮予約が存在するかどうか */
  readonly hasProvisionalOverlap: boolean;
}

/**
 * 予約詳細を、見ている人に見せてよい形にしたもの（COND-008）。
 *
 * 判別可能なユニオンにしてあり、詳細を見られない相手には
 * Summary の項目だけを渡す。どちらの形にも `groupId` は含めない。
 */
export type ReservationDetailView =
  | {
      readonly canViewDetail: false;
      readonly reservation: ReservationDetailSummary;
    }
  | {
      readonly canViewDetail: true;
      readonly reservation: ReservationDetailFull;
    };

/**
 * 予約詳細画面（SCR-005）の読み取り専用の窓口（ポート）。
 *
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 */
export interface ReservationDetailQuery {
  /**
   * 予約 ID を指定して予約詳細情報を取得する。
   *
   * 該当する予約が存在しない場合は `null` を返す。
   */
  findByReservationId(reservationId: string): ResultAsync<ReservationDetailRow | null, QueryError>;
}
