import { describe, expect, it } from "vitest";

import { ReservationAction, reservationPermissions } from ".";
import { canAct, MembershipRole, type Actor, type Membership } from "../membership";

const membershipOf = (role: MembershipRole): Membership => ({
  groupId: "grp_test",
  userId: "usr_test",
  role,
});

/** 操作する人の形。COND-007 により、団体での役割は同時に 1 つだけ */
const actors = {
  所属なし: { isStaff: false, membership: null },
  メンバー: { isStaff: false, membership: membershipOf(MembershipRole.Member) },
  管理者: { isStaff: false, membership: membershipOf(MembershipRole.Admin) },
  事務局: { isStaff: true, membership: null },
  事務局かつメンバー: { isStaff: true, membership: membershipOf(MembershipRole.Member) },
  事務局かつ管理者: { isStaff: true, membership: membershipOf(MembershipRole.Admin) },
} as const satisfies Record<string, Actor>;
type ActorName = keyof typeof actors;

/**
 * 操作する人ごとに許可される操作の期待値。
 *
 * reservationPermissions をそのまま参照すると「実装と実装を比べる」ことになり
 * 何も検証できないので、ここには期待する結果を独立して書き下す。
 */
const expected: Record<ActorName, Record<ReservationAction, boolean>> = {
  /*
   * COND-008: 所属していなくても、ログインしていれば概要（施設・日時・団体名・ステータス）は見える。
   * 空き状況カレンダー（SCR-001）が「いつ空いているか」を答えるために要る。
   */
  所属なし: {
    [ReservationAction.ViewSummary]: true,
    [ReservationAction.ViewDetail]: false,
    [ReservationAction.CreateProvisional]: false,
    [ReservationAction.Withdraw]: false,
    [ReservationAction.Cancel]: false,
  },
  // 団体の中では役割によらず同じことができる
  メンバー: {
    [ReservationAction.ViewSummary]: true,
    [ReservationAction.ViewDetail]: true,
    [ReservationAction.CreateProvisional]: true,
    [ReservationAction.Withdraw]: true,
    [ReservationAction.Cancel]: true,
  },
  管理者: {
    [ReservationAction.ViewSummary]: true,
    [ReservationAction.ViewDetail]: true,
    [ReservationAction.CreateProvisional]: true,
    [ReservationAction.Withdraw]: true,
    [ReservationAction.Cancel]: true,
  },
  /*
   * COND-009: 事務局は所属していない団体でも予約を作れ、中身も全部見られる（COND-008）。
   * 取り消し・キャンセルは事務局の操作ではない（却下・事務局キャンセルが別にある）。
   */
  事務局: {
    [ReservationAction.ViewSummary]: true,
    [ReservationAction.ViewDetail]: true,
    [ReservationAction.CreateProvisional]: true,
    [ReservationAction.Withdraw]: false,
    [ReservationAction.Cancel]: false,
  },
  /*
   * 事務局の人が自分の所属する団体の予約を扱うときは、メンバーとしての権限も併せ持つ。
   * 事務局であることを理由に、自団体の予約を取り消せなくなってはいけない。
   */
  事務局かつメンバー: {
    [ReservationAction.ViewSummary]: true,
    [ReservationAction.ViewDetail]: true,
    [ReservationAction.CreateProvisional]: true,
    [ReservationAction.Withdraw]: true,
    [ReservationAction.Cancel]: true,
  },
  事務局かつ管理者: {
    [ReservationAction.ViewSummary]: true,
    [ReservationAction.ViewDetail]: true,
    [ReservationAction.CreateProvisional]: true,
    [ReservationAction.Withdraw]: true,
    [ReservationAction.Cancel]: true,
  },
};

const combinations = (Object.keys(actors) as readonly ActorName[]).flatMap((name) =>
  Object.values(ReservationAction).map((action) => [name, action] as const),
);

describe("reservationPermissions", () => {
  it.each(combinations)("%s は %s を許可されているか判定できる", (name, action) => {
    expect(canAct(reservationPermissions, actors[name], action)).toBe(expected[name][action]);
  });
});
