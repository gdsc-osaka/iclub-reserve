import type { ResultAsync } from "neverthrow";

import type { ReservationStatus } from "~/domain/reservation";
import type { QueryError } from "../error";

/** 申請元として選べる団体 1 件分。 */
export interface ReservationFormGroup {
  readonly id: string;
  readonly name: string;
}

/** 申請先として選べる施設・設備 1 件分。 */
export interface ReservationFormFacility {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** 施設・設備の写真の URL（`/facility-photos/...`）。登録されていなければ null */
  readonly photoUrl: string | null;
}

/**
 * DB から読んだままの予約 1 件分。**画面へそのまま渡してはいけない。**
 *
 * 団体の ID は「自団体の予約かどうか」を判定するためだけに使い、
 * 画面へ渡す {@link ReservationFormReservation} では落とす（COND-008）。
 * 落とし忘れを型で防ぐために、わざと別の形にしてある。
 *
 * 使用人数・備考をそもそも読んでいないのは、この画面が出すのが
 * 「その時間帯が埋まっているか」だけだから。使わない項目は最初から取らない。
 */
export interface ReservationFormReservationRow {
  readonly id: string;
  readonly facilityId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
}

/** Query が返す、マスク前の画面 1 つ分のデータ。 */
export interface ReservationFormData {
  readonly facilities: readonly ReservationFormFacility[];
  readonly reservations: readonly ReservationFormReservationRow[];
}

/**
 * 画面へ渡してよい予約 1 件分。COND-008 に従ってマスク済み。
 *
 * 施設の ID は残している。どの施設の予約かは COND-008 が誰にでも見せてよいとしており、
 * 画面もこれを使って表示中の施設のぶんだけを絞り込むため。
 */
export interface ReservationFormReservation {
  readonly id: string;
  readonly facilityId: string;
  readonly groupName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly status: ReservationStatus;
  /** 見ている人が所属している団体の予約かどうか。帯の濃さを変えるために使う */
  readonly isOwnGroup: boolean;
}

/** {@link ReservationFormQuery.find} への入力。 */
export interface ReservationFormArgs {
  /** 予約を取得する期間の開始（この時刻を含む） */
  readonly from: Date;
  /** 予約を取得する期間の終了（この時刻を含まない） */
  readonly to: Date;
}

/**
 * 予約変更フォームの読み取り専用の窓口（ポート）。
 *
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 */
export interface ReservationFormQuery {
  /**
   * フォームに出す選択肢と、期間内の予約をまとめて取得する。
   *
   * - 有効な施設が無い場合: ok（`facilities` が空の配列）
   * - DB アクセスに失敗した場合: err(DATABASE_ERROR)
   *
   * 「見つからない」を NOT_FOUND にしないのは、画面側で理由を説明したいため。
   * エラーにすると理由の分からないエラー画面になってしまう。
   *
   * 予約は施設を絞らずに期間ぶんまとめて取る。画面は
   * 施設を切り替えても同じ日を出し続けるので、絞って取ると
   * 切り替えのたびにサーバーへの往復が 1 回増えるだけになる。
   *
   * 並び順は、施設は名前の昇順（同名は ID の昇順）、
   * 予約は開始日時の昇順（同時刻は ID の昇順）で固定する。
   */
  find(args: ReservationFormArgs): ResultAsync<ReservationFormData, QueryError>;
}
