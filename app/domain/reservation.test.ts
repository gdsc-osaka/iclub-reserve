import { describe, expect, it } from "vitest";

import { MembershipRole } from "./membership";
import {
  canTransition,
  ReservationAction,
  ReservationErrorCode,
  reservationPermissions,
  ReservationStatus,
  ReservationTransition,
  validateReservationDraft,
  validateReservationPeriod,
  validateTransitionReason,
} from "./reservation";

/** 判定の基準になる「いま」。2026 年 9 月 14 日（月）の 9 時 */
const now = new Date("2026-09-14T09:00:00+09:00");

/** 「いま」より後の、同じ週の水曜日の時刻 */
const wednesday = (time: string) => new Date(`2026-09-16T${time}:00+09:00`);

describe("validateReservationPeriod", () => {
  it("利用可能時間の中で 30 分単位に収まっていれば通る", () => {
    const period = { startAt: wednesday("10:00"), endAt: wednesday("12:00") };

    expect(validateReservationPeriod(period, now).isOk()).toBe(true);
  });

  it("最短の 30 分でも通る", () => {
    const period = { startAt: wednesday("09:00"), endAt: wednesday("09:30") };

    expect(validateReservationPeriod(period, now).isOk()).toBe(true);
  });

  it("終了が開始より前なら弾く", () => {
    const period = { startAt: wednesday("12:00"), endAt: wednesday("10:00") };
    const result = validateReservationPeriod(period, now);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidPeriod);
  });

  it("長さが 0 なら弾く", () => {
    const period = { startAt: wednesday("10:00"), endAt: wednesday("10:00") };

    expect(validateReservationPeriod(period, now).isErr()).toBe(true);
  });

  it("30 分刻みでない時刻は弾く", () => {
    const period = { startAt: wednesday("10:15"), endAt: wednesday("11:15") };
    const result = validateReservationPeriod(period, now);

    expect(result._unsafeUnwrapErr().message).toContain("30 分単位");
  });

  it("利用可能時間より前から始まる予約は弾く", () => {
    const period = { startAt: wednesday("08:30"), endAt: wednesday("10:00") };
    const result = validateReservationPeriod(period, now);

    expect(result._unsafeUnwrapErr().message).toContain("9:00〜21:00");
  });

  it("利用可能時間より後まで続く予約は弾く", () => {
    const period = { startAt: wednesday("20:00"), endAt: wednesday("21:30") };

    expect(validateReservationPeriod(period, now).isErr()).toBe(true);
  });

  it("日をまたぐ予約は弾く", () => {
    const period = {
      startAt: wednesday("20:00"),
      endAt: new Date("2026-09-17T10:00:00+09:00"),
    };
    const result = validateReservationPeriod(period, now);

    expect(result._unsafeUnwrapErr().message).toContain("日をまたぐ");
  });

  it("過ぎた日時は弾く", () => {
    const period = {
      startAt: new Date("2026-09-13T10:00:00+09:00"),
      endAt: new Date("2026-09-13T12:00:00+09:00"),
    };
    const result = validateReservationPeriod(period, now);

    expect(result._unsafeUnwrapErr().message).toContain("過ぎた日時");
  });
});

describe("validateReservationDraft", () => {
  const period = { startAt: wednesday("10:00"), endAt: wednesday("12:00") };

  it("使用人数があり、備考が上限内なら通る", () => {
    const result = validateReservationDraft({ ...period, headCount: 4, note: "週次定例" }, now);

    expect(result.isOk()).toBe(true);
  });

  it("備考は書かなくてもよい（INFO-001 で任意）", () => {
    const result = validateReservationDraft({ ...period, headCount: 1, note: null }, now);

    expect(result.isOk()).toBe(true);
  });

  it("使用人数が 0 以下なら弾く", () => {
    const result = validateReservationDraft({ ...period, headCount: 0, note: null }, now);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidInput);
  });

  it("使用人数が整数でなければ弾く", () => {
    const result = validateReservationDraft({ ...period, headCount: 2.5, note: null }, now);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidInput);
  });

  it("備考が 500 文字を超えたら弾く", () => {
    const result = validateReservationDraft(
      { ...period, headCount: 4, note: "あ".repeat(501) },
      now,
    );

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidInput);
  });

  it("利用時間が不正なら、使用人数を見る前に弾く", () => {
    const result = validateReservationDraft(
      { startAt: wednesday("10:15"), endAt: wednesday("11:15"), headCount: 0, note: null },
      now,
    );

    // 先に返るのは利用時間のエラー。直す順番が読み取れるようにしておく
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidPeriod);
  });
});

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

describe("canTransition", () => {
  /** 指定した役割でその予約の団体に所属している人 */
  const membershipOf = (...roles: MembershipRole[]) => ({
    groupId: "grp_01",
    userId: "usr_01",
    roles,
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

    it("役割を 1 つも持たない所属では、取り消しもキャンセルもできない", () => {
      /*
       * 所属しているかどうかだけで判定していると、この場合も通ってしまう。
       * 権限表を引いていることを、ここで固定しておく。
       */
      const rolelessActor = { isStaff: false, membership: membershipOf() };

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
