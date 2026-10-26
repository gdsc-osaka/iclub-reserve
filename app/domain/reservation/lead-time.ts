import { addDays } from "~/lib/date";

/**
 * 予約を申請してもらう目安の日数（COND-028）。利用の 1 週間前までに申請してもらう。
 */
export const APPLICATION_LEAD_DAYS = 7;

/**
 * 1 週間前までの申請を求める案内文（COND-028）。
 */
export const APPLICATION_DEADLINE_NOTICE =
  "予約は利用日の1週間前までに申請してください。それより後の申請も受け付けますが、承認や施設の解錠の手配が間に合わないことがあります。";

/**
 * 利用日まで 7 日を切ったときの注意文（COND-028）。
 */
export const SHORT_NOTICE_ALERT =
  "利用日まで7日を切っています。承認や施設の解錠の手配が間に合わないことがあります。";

/**
 * 利用日まで 7 日を切っているかを判定する純粋関数（COND-028）。
 *
 * 開始日時が今からちょうど 7 日後より前なら true。ちょうど 7 日後に始まる予約は
 * 「1 週間前まで」に収まるので含めない。日付ではなく日時で比べるので、
 * 同じ 7 日後の日でも、今の時刻より前に始まる予約だけが当てはまる。
 *
 * 事務局のダッシュボード（SCR-022）で承認待ちを強調するのと、
 * 申請・変更フォーム（SCR-002）で注意を出すのとで、同じ数え方を使う。
 */
export const isShortNotice = (startAt: Date, now: Date): boolean =>
  startAt < addDays(now, APPLICATION_LEAD_DAYS);
