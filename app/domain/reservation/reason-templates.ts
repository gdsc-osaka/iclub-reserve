import { ReservationTransition } from "./transition";

/*
 * 予約を終える操作の理由（COND-002）に入れる定型文をまとめたファイル。
 *
 * 定型文は、理由の欄に文を入れるための手助けでしかない。保存するのは欄に残った理由の文だけで、
 * どの定型文を選んだかは記録しない。入れた後に書き足し・書き直しができるので、
 * 選んだ定型文と保存した文が一致するとは限らず、記録しても当てにならないため。
 */

/**
 * 理由の定型文。
 */
export interface ReasonTemplate {
  /** ボタンに出す短い名前 */
  readonly label: string;
  /** 理由の欄に入れる文。そのまま予約の詳細とお知らせのメールに載る */
  readonly text: string;
}

/**
 * 事務局による却下（Reject）と事務局キャンセル（StaffCancel）で共通して使う定型文。
 *
 * 定型文の文の決まり:
 * - どの文にも、団体が次に何をすればよいかを入れる。
 * - 理由は団体の全メンバーとお知らせのメールに載るので、他の団体や個人の名前を入れない。
 * - 却下とキャンセルのどちらで使っても通じるよう、「却下」「キャンセル」の言葉を入れない。
 */
const staffReasonTemplates = [
  // 同じ施設・時間帯の別の予約を承認した・承認済みの予約がある（COND-001 の重なり）
  {
    label: "別の予約と重なる",
    text: "同じ施設・時間帯に別の予約が入っているため、この日時ではご利用いただけません。空き状況カレンダーで空いている日時を確かめて、改めて申請してください。",
  },
  // 施設の自主事業や公共的な催事を優先する（施設使用規約 第4条(5)）
  {
    label: "施設の行事",
    text: "この日時は、施設の自主事業や大学の催事に使うため、ご利用いただけません。別の日時で改めて申請してください。",
  },
  // 工事・災害などで施設を使えなくなった（施設使用規約 第8条 2項）
  {
    label: "工事・点検・災害",
    text: "工事・点検や災害などのため、この日時は施設をご利用いただけません。別の日時で改めて申請してください。",
  },
  // 利用日の 1 週間前を過ぎた申請で、解錠などの手配が間に合わない（COND-028）
  {
    label: "利用日の直前",
    text: "利用日まで日がなく、施設の解錠などの手配が間に合わないため、ご利用いただけません。予約は利用日の1週間前までに申請してください。",
  },
] as const satisfies readonly ReasonTemplate[];

/**
 * 操作ごとの定型文の表。空の配列の操作では、定型文のボタンを出さない。
 *
 * - Partial にせず全部の操作を並べる理由:
 *   操作を足したときに、定型文を出すかを決め忘れないため。
 * - 団体の取り消し・キャンセルに定型文を置かない理由:
 *   理由を書く手間によって安易な取り消しを抑える COND-002 の趣旨と合わないため。
 */
export const reasonTemplates = {
  [ReservationTransition.Withdraw]: [],
  [ReservationTransition.Cancel]: [],
  [ReservationTransition.Approve]: [],
  [ReservationTransition.Reject]: staffReasonTemplates,
  [ReservationTransition.StaffCancel]: staffReasonTemplates,
} as const satisfies Record<ReservationTransition, readonly ReasonTemplate[]>;

/**
 * 理由の欄の今の文に、定型文を入れた結果を返す純粋関数。
 *
 * - 欄が空か空白だけなら、定型文で埋める
 * - 欄にすでに同じ定型文があれば、そのまま返す（同じボタンを 2 回押しても、同じ文が重ならない）
 * - 何か書いてあれば、末尾の空白・改行を除いてから改行 1 つをはさんで後ろに足す
 *
 * 書いてある文を置き換えないのは、事務局が先に書いた事情を消さないため。
 */
export const toReasonWithTemplate = (current: string, template: string): string => {
  if (current.trim() === "") {
    return template;
  }
  if (current.includes(template)) {
    return current;
  }
  return `${current.trimEnd()}\n${template}`;
};
