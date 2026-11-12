import { ReservationTransition } from "~/domain/reservation/transition";
import type { FlashToastInput } from "~/lib/flash-toast";

/** 操作ごとのトーストのタイトル一覧。操作を足し忘れたら型で分かるようにする */
const TITLES: Record<ReservationTransition, string> = {
  [ReservationTransition.Withdraw]: "仮予約を取り消しました",
  [ReservationTransition.Cancel]: "予約をキャンセルしました",
  [ReservationTransition.Approve]: "予約を承認しました",
  [ReservationTransition.Reject]: "仮予約を却下しました",
  [ReservationTransition.StaffCancel]: "予約をキャンセルしました",
};

/**
 * 予約の状態変更操作の結果から、トーストに表示する文言を組み立てる。
 */
export const toReservationTransitionToast = (
  transition: ReservationTransition,
  rejectedCount: number,
): FlashToastInput => {
  const title = TITLES[transition];
  if (transition === ReservationTransition.Approve && rejectedCount >= 1) {
    return {
      title,
      description: `重なっていた仮予約 ${rejectedCount} 件を却下しました。`,
    };
  }
  return { title };
};
