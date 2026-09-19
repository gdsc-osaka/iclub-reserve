import type { ResultAsync } from "neverthrow";

import type { ReservationStatus } from "~/domain/reservation";
import type { QueryError } from "../error";

/** 絞り込みドロップダウンで選べる施設・設備 1 件分。 */
export interface ReservationListFacility {
  readonly id: string;
  readonly name: string;
}

/**
 * DB から読んだままの予約一覧の 1 行。**画面へそのまま渡してはいけない。**
 *
 * 団体の ID は「見ている人が所属している団体かどうか」を判定・絞り込むために使い、
 * 画面へ渡す {@link ReservationListItem} では落とす（COND-008）。
 * 画面側で隠すのでは、通信の中身を見れば ID が分かってしまう。
 *
 * 落とし忘れを型で防ぐために、画面へ渡す {@link ReservationListItem} とは
 * わざと別の型に分けてある（ADR-001 / facility-availability-calendar.ts と同様の理由）。
 */
export interface ReservationListRow {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly facilityId: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
  readonly statusReason: string | null;
  readonly headCount: number;
  readonly note: string | null;
  readonly createdByName: string | null;
  readonly createdAt: Date;
}

/**
 * 画面へ渡してよい予約一覧の 1 行。
 *
 * 団体の ID を持たせていないのは、COND-008 が他団体に見せてよいとしているのが
 * 団体「名」までのため。画面は団体名しか出さないので ID は要らない。
 * 使わない識別子を載せると、通信の中身を見れば団体を特定できてしまう。
 */
export interface ReservationListItem {
  readonly id: string;
  readonly groupName: string;
  readonly facilityId: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
  readonly statusReason: string | null;
  readonly headCount: number;
  readonly note: string | null;
  readonly createdByName: string | null;
  readonly createdAt: Date;
}

/** ステータス別の件数。ピル型タブの横に添える数字として使う。 */
export interface ReservationStatusCounts {
  /** 条件に合うすべての予約件数 */
  readonly all: number;
  /** 仮予約の件数 */
  readonly provisional: number;
  /** 承認済みの件数 */
  readonly approved: number;
  /** 終了した予約（取り消し・却下・キャンセル）の合計件数 */
  readonly ended: number;
}

/** 一覧の並び順の指定。 */
export type ReservationListSort = "start_at_asc" | "start_at_desc" | "created_at_asc";

/** {@link ReservationListQuery.findList} への入力。 */
export interface ReservationListQueryArgs {
  /**
   * 絞り込み対象の団体 ID の配列。
   *
   * null のときは全団体の予約を取得する。
   * **null を渡してよいのは事務局スタッフ（`user.is_staff = true`）のときだけ**（COND-009）。
   * 一般利用者の場合は、必ず本人が実際に所属している団体 ID のみで絞り込むこと。
   * 空配列の場合は該当なしとして即座に空の一覧を返す。
   */
  readonly groupIds: readonly string[] | null;
  /** 取得対象のステータス一覧 */
  readonly statuses: readonly ReservationStatus[];
  /** 施設・設備 ID による絞り込み。null のときは全施設 */
  readonly facilityId: string | null;
  /** 予約の開始・終了日時による絞り込み。null のときは制限なし */
  readonly from: Date | null;
  readonly to: Date | null;
  /** 並び順 */
  readonly sort: ReservationListSort;
  /** 取得件数の上限 */
  readonly limit?: number;
}

/** {@link ReservationListQuery.countByStatus} への入力。 */
export interface ReservationListCountArgs {
  /**
   * 集計対象の団体 ID の配列。
   *
   * null のときは全団体の予約を集計する。
   * **null を渡してよいのは事務局スタッフのときだけ**（COND-009）。
   */
  readonly groupIds: readonly string[] | null;
  /** 施設・設備 ID による絞り込み。null のときは全施設 */
  readonly facilityId: string | null;
  /** 期間による絞り込み */
  readonly from: Date | null;
  readonly to: Date | null;
}

/**
 * 予約一覧・管理画面（SCR-003）の読み取り専用の窓口（ポート）。
 *
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 */
export interface ReservationListQuery {
  /**
   * 条件に一致する予約一覧を取得する。
   *
   * 並び順は指定された `sort` に従い、同一時刻のものは予約 ID の昇順で並べる。
   * 順序を決めずに返すと、再読み込みのたびに順番が入れ替わって見えてしまう。
   */
  findList(args: ReservationListQueryArgs): ResultAsync<readonly ReservationListRow[], QueryError>;

  /**
   * 現在の団体・施設・期間の絞り込み条件における、ステータス別の件数を集計して返す。
   */
  countByStatus(args: ReservationListCountArgs): ResultAsync<ReservationStatusCounts, QueryError>;

  /**
   * 絞り込みドロップダウンに表示する有効な施設・設備の一覧を名前順で取得する。
   */
  findFacilities(): ResultAsync<readonly ReservationListFacility[], QueryError>;
}
