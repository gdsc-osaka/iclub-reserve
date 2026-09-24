import { Button } from "~/components/ui/button";
import { ReservationStatus } from "~/domain/reservation";
import { ReservationTransition } from "~/domain/reservation/transition";
import type { ReservationListItem } from "~/query/reservation/reservation-list";
import { ReservationActionDialog, type ReservationActionTarget } from "./reservation-action-dialog";

/** 取り消し・却下・キャンセルのボタンの見た目。取り返しのつかない操作なので赤で縁取る */
const destructiveOutlineClassName =
  "h-8 border-destructive/40 px-3 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive";

/**
 * 予約の状態変更ボタン（承認 → 却下 → 取り消し → キャンセル）を並べる。
 *
 * 予約一覧（SCR-003）と予約詳細（SCR-005）で共有する。どのボタンを出すかは
 * 受け取った `transitions`（ドメインの `allowedTransitions` の結果）だけで決め、
 * ここで status を見て分岐させない。サーバーが許す操作とすぐにずれるため。
 *
 * ボタンだけを返し、並べる外枠は呼び出し側が持つ。
 * 一覧では、カード全面のリンクより前面に出す枠が要るため。
 */
export function ReservationActionButtons({
  item,
  transitions,
  showGroupName,
}: Readonly<{
  item: ReservationActionTarget & Pick<ReservationListItem, "status" | "hasApprovedOverlap">;
  transitions: readonly ReservationTransition[];
  showGroupName: boolean;
}>) {
  const canCancel = transitions.includes(ReservationTransition.Cancel);
  const canStaffCancel = transitions.includes(ReservationTransition.StaffCancel);

  // 承認済みの予約と重なる仮予約は承認できない（COND-001）。押せないことを先に見せる
  const isApproveBlocked =
    item.status === ReservationStatus.Provisional && (item.hasApprovedOverlap ?? false);

  return (
    <>
      {transitions.includes(ReservationTransition.Approve) && (
        <ReservationActionDialog
          item={item}
          transition={ReservationTransition.Approve}
          showGroupName={showGroupName}
          disabled={isApproveBlocked}
          trigger={
            <Button
              size="sm"
              variant="default"
              disabled={isApproveBlocked}
              className="h-8 px-3 text-xs font-medium"
            >
              承認
            </Button>
          }
        />
      )}
      {transitions.includes(ReservationTransition.Reject) && (
        <ReservationActionDialog
          item={item}
          transition={ReservationTransition.Reject}
          showGroupName={showGroupName}
          trigger={
            <Button size="sm" variant="outline" className={destructiveOutlineClassName}>
              却下
            </Button>
          }
        />
      )}
      {transitions.includes(ReservationTransition.Withdraw) && (
        <ReservationActionDialog
          item={item}
          transition={ReservationTransition.Withdraw}
          showGroupName={showGroupName}
          trigger={
            <Button size="sm" variant="outline" className={destructiveOutlineClassName}>
              取り消し
            </Button>
          }
        />
      )}
      {canCancel && (
        <ReservationActionDialog
          item={item}
          transition={ReservationTransition.Cancel}
          showGroupName={showGroupName}
          trigger={
            <Button size="sm" variant="outline" className={destructiveOutlineClassName}>
              キャンセル
            </Button>
          }
        />
      )}
      {/*
       * 事務局キャンセルは、団体のキャンセルとは別のボタンにする。行き着く状態も、
       * 理由が必須かどうか（COND-002）も違うので、片方にまとめると選べない方が出る。
       * 両方が並ぶのは、事務局の人がその団体のメンバーを兼ねているとき（予約詳細）だけ。
       * そのときだけ名前で見分けられるようにし、事務局の画面では「キャンセル」のままにする。
       */}
      {canStaffCancel && (
        <ReservationActionDialog
          item={item}
          transition={ReservationTransition.StaffCancel}
          showGroupName={showGroupName}
          trigger={
            <Button size="sm" variant="outline" className={destructiveOutlineClassName}>
              {canCancel ? "事務局キャンセル" : "キャンセル"}
            </Button>
          }
        />
      )}
    </>
  );
}
