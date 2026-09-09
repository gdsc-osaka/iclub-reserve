import type { ResultAsync } from "neverthrow";

import type { GroupStatus } from "~/domain/group";
import type { ReservationStatus } from "~/domain/reservation";
import type { QueryError } from "../error";

/**
 * 一覧に並ぶ予約 1 件分。画面に出す項目だけを持つ。
 *
 * 自分が所属している団体の予約しか入らないので、
 * 使用人数・備考・理由まで含めてよい (COND-008 の「自団体」の列)。
 */
export interface UserReservationListItem {
  readonly reservationId: string;
  readonly groupId: string;
  readonly groupName: string;
  readonly facilityId: string;
  readonly facilityName: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly headCount: number;
  readonly note: string | null;
  readonly status: ReservationStatus;
  /** 却下・キャンセルの理由 (COND-002)。それ以外のステータスでは表示しない */
  readonly statusReason: string | null;
}

/**
 * この一覧が対象にしている団体。
 *
 * 予約が 1 件も無いときに「団体に所属していない」のか
 * 「所属しているがまだ予約が無い」のかを画面で見分けるために持つ。
 * 承認待ちの団体は予約を申請できない (COND-006) ので、状態も併せて返す。
 */
export interface UserReservationListGroup {
  readonly groupId: string;
  readonly name: string;
  readonly status: GroupStatus;
}

/** トップページ (SCR-003 の団体側) 1 画面分のデータ。 */
export interface UserReservationList {
  readonly groups: readonly UserReservationListGroup[];
  /** これからの予定。開始が早い順 */
  readonly upcoming: readonly UserReservationListItem[];
  /** 終わった予約と、取り消し・却下・キャンセルされた予約。新しい順 */
  readonly past: readonly UserReservationListItem[];
  /** 履歴が `pastLimit` で打ち切られたかどうか。画面の「ほかにもあります」の表示に使う */
  readonly isPastTruncated: boolean;
}

/** 一覧の絞り込み条件。 */
export interface UserReservationListCriteria {
  /**
   * 「これから」と「履歴」を分ける基準時刻。
   *
   * 実装側で `new Date()` を呼ばず、必ず外から渡す。
   * 呼び出し側が時刻を決められないと、境目のテストが書けなくなるため。
   */
  readonly now: Date;
  /** 履歴として返す最大件数 */
  readonly pastLimit: number;
}

/**
 * 「自分が所属する団体の予約一覧」を読む窓口 (ポート)。
 *
 * Repository が「集約 1 件」を返すのに対し、Query は「画面 1 つ分」を返す。
 * 返る型はドメインの不変条件を持たないので、
 * **この結果を使って更新してはいけない**。更新は必ず Repository を通すこと。
 *
 * 引数が `userId` なので `query/user/` に置いている
 * (docs/adr/001-read-model-separation.md の決定 3)。
 * 団体 1 つ分の一覧 (SCR-003 を団体ページとして開く場合) は
 * `query/group/group-reservation-list.ts` に別途作る。同じテーブルを読むが、
 * 絞り込みも認可も違うので分けてよい (同 ADR の決定 5)。
 */
export interface UserReservationListQuery {
  findByUserId(
    userId: string,
    criteria: UserReservationListCriteria,
  ): ResultAsync<UserReservationList, QueryError>;
}
