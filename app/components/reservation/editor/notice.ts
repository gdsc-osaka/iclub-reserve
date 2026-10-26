import { ReservationStatus } from "~/domain/reservation";
import { editTargetStatus, ReservationEditOutcome } from "~/domain/reservation/edit";
import { isShortNotice } from "~/domain/reservation/lead-time";

/**
 * 申請の期限の目安（COND-028）の案内と注意を出すかを決めるための、フォームでのいまの操作。
 *
 * 変更の `outcome` は、フォームが求めた変更の結果（`toEditPreview`）。
 * 時間帯を選んでいないなど、まだ比べられないときは null。
 */
export type ReservationEditorNoticeContext =
  | { readonly kind: "create"; readonly isDirect: boolean }
  | {
      readonly kind: "edit";
      readonly isDirect: boolean;
      readonly outcome: ReservationEditOutcome | null;
    };

/**
 * 1 週間前までの申請の案内（`APPLICATION_DEADLINE_NOTICE`）を出すか（COND-028）。
 *
 * 団体の申請・変更ではいつも出し、事務局の直接作成・直接変更では出さない。
 * 直接作成・直接変更は承認を待たず、解錠の手配も事務局がその場で選ぶため。
 */
export const shouldShowApplicationNotice = (context: ReservationEditorNoticeContext): boolean =>
  !context.isDirect;

/**
 * 送った後、予約が事務局の承認を待つ（仮予約になる）か。
 *
 * 申請はいつも仮予約になる。団体の変更は、変更後の状態（`editTargetStatus`）で決まる。
 * 1 項目も変えていないときは何も送らないので、待つものは無い。
 */
const awaitsApproval = (context: ReservationEditorNoticeContext): boolean => {
  if (context.isDirect) return false;
  if (context.kind === "create") return true;
  if (context.outcome === null || context.outcome === ReservationEditOutcome.NoChange) return false;

  return editTargetStatus[context.outcome] === ReservationStatus.Provisional;
};

/**
 * 利用日まで 7 日を切ったときの注意（`SHORT_NOTICE_ALERT`）を出すか（COND-028）。
 *
 * 承認を待つ操作で、選んでいる開始日時が 7 日を切っているときだけ出す。
 * 承認済みのまま使用人数・備考だけを変えるときは、承認も解錠の手配もやり直さないので出さない。
 */
export const shouldShowShortNoticeAlert = (
  context: ReservationEditorNoticeContext,
  startAt: Date | null,
  now: Date,
): boolean => startAt !== null && awaitsApproval(context) && isShortNotice(startAt, now);
