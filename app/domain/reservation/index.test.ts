import { describe, expect, it } from "vitest";

import { MembershipRole } from "../membership";
import { ReservationAction, reservationPermissions } from ".";

describe("reservationPermissions", () => {
  it("Admin と Member の両方に仮予約申請・取り消し・キャンセルが許可されている", () => {
    expect(reservationPermissions[MembershipRole.Admin]).toEqual([
      ReservationAction.CreateProvisional,
      ReservationAction.Withdraw,
      ReservationAction.Cancel,
    ]);
    expect(reservationPermissions[MembershipRole.Member]).toEqual([
      ReservationAction.CreateProvisional,
      ReservationAction.Withdraw,
      ReservationAction.Cancel,
    ]);
  });
});
