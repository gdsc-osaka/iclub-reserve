import type { ResultAsync } from "neverthrow";

import type { ReservationStatus } from "~/domain/reservation";
import type { QueryError } from "../error";

/** カレンダーで切り替えられる施設・設備 1 件分。 */
export interface AvailabilityFacility {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
}

/**
 * DB から読んだままの予約 1 件分。**画面へそのまま渡してはいけない。**
 *
 * 使用人数・備考は自団体のメンバーと事務局にしか見せない項目なので（COND-008）、
 * 誰が見ているかを知っているユースケース層で落としてから画面へ渡す。
 * 画面側で隠す（CSS で非表示にする等）のでは、通信の中身を見れば読めてしまうため意味がない。
 *
 * 落とし忘れを型で防ぐために、画面へ渡す {@link AvailabilityReservation} とは
 * わざと別の形にしてある。同じ形にすると、ユースケースを通さずに
 * そのまま返すコードが書けてしまう。
 */
export interface AvailabilityReservationRow {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
  readonly headCount: number;
  readonly note: string | null;
}

/** Query が返す、マスク前の画面 1 つ分のデータ。 */
export interface FacilityAvailabilityCalendar {
  /** 有効な施設・設備の一覧。画面上部の切り替えに使う */
  readonly facilities: readonly AvailabilityFacility[];
  /** いま表示している施設・設備 */
  readonly facility: AvailabilityFacility;
  /** 期間内の予約。開始日時の昇順 */
  readonly reservations: readonly AvailabilityReservationRow[];
}

/** 自団体のメンバーと事務局にだけ見せる項目（COND-008 の 1 段階目）。 */
export interface AvailabilityReservationDetail {
  readonly headCount: number;
  readonly note: string | null;
}

/** 画面へ渡してよい予約 1 件分。COND-008 に従ってマスク済み。 */
export interface AvailabilityReservation {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
  /**
   * 見ている人が所属している団体の予約かどうか。
   *
   * 見た目を変えるために使う。事務局はすべての予約の中身を見られるので、
   * `detail` の有無では自団体かどうかを判別できない。
   */
  readonly isOwnGroup: boolean;
  /**
   * 自団体の予約と、事務局が見ている場合にだけ入る。他団体の予約では null。
   *
   * `headCount` と `note` を直接ぶら下げて「他団体では undefined」にしていないのは、
   * 値が入っているかを確かめずに画面へ書いてしまう事故を防ぐため。
   * 入れ子にしておけば、null を外さないと中身に触れない。
   */
  readonly detail: AvailabilityReservationDetail | null;
}

/** 画面へ渡してよい、空き状況カレンダー 1 画面分のデータ。 */
export interface AvailabilityCalendar {
  readonly facilities: readonly AvailabilityFacility[];
  readonly facility: AvailabilityFacility;
  readonly reservations: readonly AvailabilityReservation[];
  /**
   * 見ている人が、いま予約を申請できる状態かどうか（COND-006）。
   *
   * 有効な団体に 1 つも所属していない人（承認待ちの団体だけの人を含む）は false。
   * 事務局は所属に関わらず予約を直接作成できるので true（COND-009）。
   *
   * false のときに申請の導線を消してしまわないこと。押せないだけの状態で残し、
   * なぜ押せないかを画面に書く。消すと不具合だと思って何度も試すことになる。
   */
  readonly canApplyReservation: boolean;
}

/** {@link FacilityAvailabilityCalendarQuery.findByFacilityAndPeriod} への入力。 */
export interface FacilityAvailabilityCalendarArgs {
  /**
   * 表示する施設・設備の ID。
   *
   * null のときは一覧の先頭を返す。画面を開いた直後はまだ施設を選んでいないので、
   * 「どれも選ばれていない空のカレンダー」を出さずに済むようにしている。
   */
  readonly facilityId: string | null;
  /** 取得する期間の開始（この時刻を含む） */
  readonly from: Date;
  /** 取得する期間の終了（この時刻を含まない） */
  readonly to: Date;
}

/**
 * 空き状況カレンダー（SCR-001）の読み取り専用の窓口（ポート）。
 *
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 */
export interface FacilityAvailabilityCalendarQuery {
  /**
   * 施設 1 件分の、期間内の予約を取得する。
   *
   * - 有効な施設が 1 件も無い場合: err(NOT_FOUND)
   * - `facilityId` の施設が存在しない、または無効な場合: err(NOT_FOUND)
   * - 期間内に予約が無い場合: ok（`reservations` が空の配列）
   *
   * 取得するのは仮予約と承認済みだけ（`calendarVisibleStatuses`）。
   * 終了した予約まで描くと、空いている時間帯が埋まって見えてしまう。
   *
   * 他団体の予約も取得する。この画面は「施設がいつ空いているか」を知るためのもので、
   * 自団体の予約だけでは空いているかどうかが分からないため。
   *
   * 並び順は開始日時の昇順で固定する。同じ時刻に始まる予約は予約 ID の昇順で並べる。
   * 順序を決めずに返すと、再読み込みのたびに重なった帯の左右が入れ替わって見える。
   */
  findByFacilityAndPeriod(
    args: FacilityAvailabilityCalendarArgs,
  ): ResultAsync<FacilityAvailabilityCalendar, QueryError>;
}
