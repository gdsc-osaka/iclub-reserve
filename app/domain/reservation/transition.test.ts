import { describe, expect, it } from "vitest";

import { MembershipRole } from "../membership";
import { ReservationErrorCode, ReservationStatus } from ".";
import {
  canTransition,
  isStaffTransition,
  parseReservationTransition,
  ReservationTransition,
  validateTransitionReason,
} from "./transition";

describe("canTransition", () => {
  /** 指定した役割でその予約の団体に所属している人 */
  const membershipOf = (role: MembershipRole) => ({
    groupId: "grp_01",
    userId: "usr_01",
    role,
  });

  const memberActor = { isStaff: false, membership: membershipOf(MembershipRole.Member) };
  const adminActor = { isStaff: false, membership: membershipOf(MembershipRole.Admin) };
  const nonMemberActor = { isStaff: false, membership: null };
  const staffActor = { isStaff: true, membership: null };

  describe("権限表（reservationPermissions）にもとづく判定", () => {
    it("管理者も取り消し・キャンセルができる", () => {
      expect(
        canTransition(
          { status: ReservationStatus.Provisional },
          ReservationTransition.Withdraw,
          adminActor,
        ).isOk(),
      ).toBe(true);
      expect(
        canTransition(
          { status: ReservationStatus.Approved },
          ReservationTransition.Cancel,
          adminActor,
        ).isOk(),
      ).toBe(true);
    });

    it("未定義の役割の所属では、取り消しもキャンセルもできない", () => {
      /*
       * 所属しているかどうかだけで判定していると、この場合も通ってしまう。
       * 権限表を引いていることを、ここで固定しておく。
       */
      const rolelessActor = {
        isStaff: false,
        membership: membershipOf("unknown" as MembershipRole),
      };

      expect(
        canTransition(
          { status: ReservationStatus.Provisional },
          ReservationTransition.Withdraw,
          rolelessActor,
        )._unsafeUnwrapErr().code,
      ).toBe(ReservationErrorCode.ReservationForbidden);
      expect(
        canTransition(
          { status: ReservationStatus.Approved },
          ReservationTransition.Cancel,
          rolelessActor,
        )._unsafeUnwrapErr().code,
      ).toBe(ReservationErrorCode.ReservationForbidden);
    });
  });

  describe("成功する状態遷移", () => {
    it("自団体メンバーは仮予約を取り消せる（provisional → withdrawn）", () => {
      const result = canTransition(
        { status: ReservationStatus.Provisional },
        ReservationTransition.Withdraw,
        memberActor,
      );
      expect(result.isOk()).toBe(true);
    });

    it("自団体メンバーは承認済み予約をキャンセルできる（approved → cancelled）", () => {
      const result = canTransition(
        { status: ReservationStatus.Approved },
        ReservationTransition.Cancel,
        memberActor,
      );
      expect(result.isOk()).toBe(true);
    });

    it("事務局は仮予約を承認できる（provisional → approved）", () => {
      const result = canTransition(
        { status: ReservationStatus.Provisional },
        ReservationTransition.Approve,
        staffActor,
      );
      expect(result.isOk()).toBe(true);
    });

    it("事務局は理由を入力して仮予約を却下できる（provisional → rejected）", () => {
      const result = canTransition(
        { status: ReservationStatus.Provisional },
        ReservationTransition.Reject,
        staffActor,
        "施設のメンテナンスのため",
      );
      expect(result.isOk()).toBe(true);
    });

    it("事務局は理由を入力して承認済み予約をキャンセルできる（approved → cancelled_by_staff）", () => {
      const result = canTransition(
        { status: ReservationStatus.Approved },
        ReservationTransition.StaffCancel,
        staffActor,
        "緊急点検のため",
      );
      expect(result.isOk()).toBe(true);
    });
  });

  describe("権限による制限", () => {
    it("他団体（非メンバーかつ非スタッフ）は取り消しできない", () => {
      const result = canTransition(
        { status: ReservationStatus.Provisional },
        ReservationTransition.Withdraw,
        nonMemberActor,
      );
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationForbidden);
    });

    it("他団体（非メンバーかつ非スタッフ）はキャンセルできない", () => {
      const result = canTransition(
        { status: ReservationStatus.Approved },
        ReservationTransition.Cancel,
        nonMemberActor,
      );
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationForbidden);
    });

    it("一般メンバー（非スタッフ）は承認できない", () => {
      const result = canTransition(
        { status: ReservationStatus.Provisional },
        ReservationTransition.Approve,
        memberActor,
      );
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationForbidden);
    });

    it("一般メンバー（非スタッフ）は却下できない", () => {
      const result = canTransition(
        { status: ReservationStatus.Provisional },
        ReservationTransition.Reject,
        memberActor,
        "理由",
      );
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationForbidden);
    });

    it("一般メンバー（非スタッフ）は事務局キャンセルできない", () => {
      const result = canTransition(
        { status: ReservationStatus.Approved },
        ReservationTransition.StaffCancel,
        memberActor,
        "理由",
      );
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationForbidden);
    });

    it("非メンバーの事務局は取り消し（withdraw）ではなく却下（reject）を行う", () => {
      const result = canTransition(
        { status: ReservationStatus.Provisional },
        ReservationTransition.Withdraw,
        staffActor,
      );
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationForbidden);
    });
  });

  describe("不正なステータス遷移（STATE-001）", () => {
    it("承認済み予約に対して取り消しはできない", () => {
      const result = canTransition(
        { status: ReservationStatus.Approved },
        ReservationTransition.Withdraw,
        memberActor,
      );
      expect(result._unsafeUnwrapErr().code).toBe(
        ReservationErrorCode.ReservationInvalidTransition,
      );
    });

    it("仮予約に対して通常のキャンセルはできない", () => {
      const result = canTransition(
        { status: ReservationStatus.Provisional },
        ReservationTransition.Cancel,
        memberActor,
      );
      expect(result._unsafeUnwrapErr().code).toBe(
        ReservationErrorCode.ReservationInvalidTransition,
      );
    });

    it("承認済み予約に対して承認はできない", () => {
      const result = canTransition(
        { status: ReservationStatus.Approved },
        ReservationTransition.Approve,
        staffActor,
      );
      expect(result._unsafeUnwrapErr().code).toBe(
        ReservationErrorCode.ReservationInvalidTransition,
      );
    });

    it("承認済み予約に対して却下はできない", () => {
      const result = canTransition(
        { status: ReservationStatus.Approved },
        ReservationTransition.Reject,
        staffActor,
        "理由",
      );
      expect(result._unsafeUnwrapErr().code).toBe(
        ReservationErrorCode.ReservationInvalidTransition,
      );
    });

    it("仮予約に対して事務局キャンセルはできない", () => {
      const result = canTransition(
        { status: ReservationStatus.Provisional },
        ReservationTransition.StaffCancel,
        staffActor,
        "理由",
      );
      expect(result._unsafeUnwrapErr().code).toBe(
        ReservationErrorCode.ReservationInvalidTransition,
      );
    });

    const endedStatuses = [
      ReservationStatus.Withdrawn,
      ReservationStatus.Rejected,
      ReservationStatus.Cancelled,
      ReservationStatus.CancelledByStaff,
    ];

    it.each(endedStatuses)("終了した状態（%s）からの遷移はすべて拒否される", (status) => {
      for (const transition of Object.values(ReservationTransition)) {
        const actor = { isStaff: true, membership: membershipOf(MembershipRole.Admin) };
        const result = canTransition({ status }, transition, actor, "理由");
        expect(result._unsafeUnwrapErr().code).toBe(
          ReservationErrorCode.ReservationInvalidTransition,
        );
      }
    });
  });
});

describe("validateTransitionReason (COND-002)", () => {
  describe("却下（Reject）", () => {
    it("理由があれば通る（前後の空白はトリムされる）", () => {
      const result = validateTransitionReason(ReservationTransition.Reject, "  日程重複のため  ");
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("日程重複のため");
    });

    it("理由が null のときは弾く", () => {
      const result = validateTransitionReason(ReservationTransition.Reject, null);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidInput);
    });

    it("空文字は弾く", () => {
      const result = validateTransitionReason(ReservationTransition.Reject, "");
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidInput);
    });

    it("空白のみは弾く", () => {
      const result = validateTransitionReason(ReservationTransition.Reject, "   \n\t  ");
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidInput);
    });
  });

  describe("事務局キャンセル（StaffCancel）", () => {
    it("理由があれば通る", () => {
      const result = validateTransitionReason(ReservationTransition.StaffCancel, "機材故障のため");
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("機材故障のため");
    });

    it("理由が無い場合は弾く", () => {
      const result = validateTransitionReason(ReservationTransition.StaffCancel, "");
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidInput);
    });

    it("空白のみは弾く", () => {
      const result = validateTransitionReason(ReservationTransition.StaffCancel, "   ");
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidInput);
    });
  });

  describe("取り消し（Withdraw）とキャンセル（Cancel）", () => {
    it("理由がなくても通る（null に正規化される）", () => {
      expect(
        validateTransitionReason(ReservationTransition.Withdraw, null)._unsafeUnwrap(),
      ).toBeNull();
      expect(validateTransitionReason(ReservationTransition.Cancel, "")._unsafeUnwrap()).toBeNull();
      expect(
        validateTransitionReason(ReservationTransition.Cancel, "   ")._unsafeUnwrap(),
      ).toBeNull();
    });

    it("理由があれば保存される", () => {
      expect(
        validateTransitionReason(ReservationTransition.Withdraw, "急用のため")._unsafeUnwrap(),
      ).toBe("急用のため");
      expect(
        validateTransitionReason(ReservationTransition.Cancel, "予定変更")._unsafeUnwrap(),
      ).toBe("予定変更");
    });
  });

  describe("承認（Approve）", () => {
    it("理由は常に null として扱われる", () => {
      expect(
        validateTransitionReason(ReservationTransition.Approve, "任意文字列")._unsafeUnwrap(),
      ).toBeNull();
    });
  });
});

describe("parseReservationTransition", () => {
  it("知っている操作は、そのまま操作として読み取る", () => {
    expect(parseReservationTransition("withdraw")).toBe(ReservationTransition.Withdraw);
    expect(parseReservationTransition("staffCancel")).toBe(ReservationTransition.StaffCancel);
  });

  it("知らない値・値でないものは null にする", () => {
    /*
     * フォームから届く値は何でもありうる。ここで弾けないと、
     * 知らない文字列がそのまま操作としてユースケースへ流れる。
     */
    expect(parseReservationTransition("approve_all")).toBeNull();
    expect(parseReservationTransition("")).toBeNull();
    expect(parseReservationTransition(null)).toBeNull();
    expect(parseReservationTransition(new File([], "a.txt"))).toBeNull();
  });
});

describe("isStaffTransition", () => {
  it("承認・却下・事務局キャンセルは事務局の操作", () => {
    expect(isStaffTransition(ReservationTransition.Approve)).toBe(true);
    expect(isStaffTransition(ReservationTransition.Reject)).toBe(true);
    expect(isStaffTransition(ReservationTransition.StaffCancel)).toBe(true);
  });

  it("取り消し・キャンセルは団体の操作", () => {
    expect(isStaffTransition(ReservationTransition.Withdraw)).toBe(false);
    expect(isStaffTransition(ReservationTransition.Cancel)).toBe(false);
  });

  it("すべての操作が、どちらかに振り分けられている", () => {
    /*
     * 画面（ルート）が受け付ける操作は、この判定だけで分けている。
     * 操作を増やしたときに振り分けが抜けると、その操作はどちらの画面でも動かない。
     */
    const transitions = Object.values(ReservationTransition);
    const staffOnly = transitions.filter((transition) => isStaffTransition(transition));
    const groupOnly = transitions.filter((transition) => !isStaffTransition(transition));

    expect(staffOnly.length + groupOnly.length).toBe(transitions.length);
    expect(staffOnly.length).toBeGreaterThan(0);
    expect(groupOnly.length).toBeGreaterThan(0);
  });
});
