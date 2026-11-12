import { describe, expect, it } from "vite-plus/test";

import { ReservationTransition } from "~/domain/reservation/transition";
import { toReservationTransitionToast } from "./reservation-transition-toast";

describe("toReservationTransitionToast", () => {
  it("Withdraw のとき「仮予約を取り消しました」を返す", () => {
    expect(toReservationTransitionToast(ReservationTransition.Withdraw, 0)).toEqual({
      title: "仮予約を取り消しました",
    });
  });

  it("Cancel のとき「予約をキャンセルしました」を返す", () => {
    expect(toReservationTransitionToast(ReservationTransition.Cancel, 0)).toEqual({
      title: "予約をキャンセルしました",
    });
  });

  it("Approve かつ却下 0 件のとき、description なしで「予約を承認しました」を返す", () => {
    expect(toReservationTransitionToast(ReservationTransition.Approve, 0)).toEqual({
      title: "予約を承認しました",
    });
  });

  it("Approve かつ却下 2 件のとき、description つきで返す", () => {
    expect(toReservationTransitionToast(ReservationTransition.Approve, 2)).toEqual({
      title: "予約を承認しました",
      description: "重なっていた仮予約 2 件を却下しました。",
    });
  });

  it("Reject のとき「仮予約を却下しました」を返す", () => {
    expect(toReservationTransitionToast(ReservationTransition.Reject, 0)).toEqual({
      title: "仮予約を却下しました",
    });
  });

  it("StaffCancel のとき「予約をキャンセルしました」を返す", () => {
    expect(toReservationTransitionToast(ReservationTransition.StaffCancel, 0)).toEqual({
      title: "予約をキャンセルしました",
    });
  });
});
