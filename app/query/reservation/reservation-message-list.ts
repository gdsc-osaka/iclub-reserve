import type { ResultAsync } from "neverthrow";

import type { QueryError } from "../error";

/**
 * DB から読んだままのメッセージ。**画面へそのまま渡してはいけない**（送信者の ID と氏名を持つため）。
 *
 * 送信者の ID は「見ている人が自分で送ったものか」の判定（isMine）に使い、
 * 氏名は事務局以外が見る事務局送信で秘匿するために使う（COND-008）。
 * 画面側で隠すのでは、通信の中身を見れば ID や氏名が分かってしまう。
 *
 * 落とし忘れを型で防ぐために、画面へ渡す型とはわざと別に分けてある（ADR-001）。
 */
export interface ReservationMessageRow {
  readonly id: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly sentAsStaff: boolean;
  readonly body: string;
  readonly sentAt: Date;
}

/**
 * 画面へ渡すメッセージ。
 *
 * 送信者の ID は持たせない（通信の中身から事務局員を特定できてしまうため）。
 */
export interface ReservationMessageView {
  readonly id: string;
  /** 画面に出す送信者（toMessageSenderLabel の結果） */
  readonly senderLabel: string;
  /** 見ている人が自分で送ったものか */
  readonly isMine: boolean;
  readonly body: string;
  readonly sentAt: Date;
}

/**
 * 予約詳細画面（SCR-005）でメッセージ一覧を表示するための読み取り窓口（ポート）。
 */
export interface ReservationMessageListQuery {
  /** その予約のメッセージを、送った順（同じ時刻なら ID の昇順）に返す。無ければ空配列 */
  listByReservationId(
    reservationId: string,
  ): ResultAsync<readonly ReservationMessageRow[], QueryError>;
}
