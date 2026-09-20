import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationStatus,
  type Reservation,
  type ReservationRepository,
} from "~/domain/reservation";
import { ReservationTransition } from "~/domain/reservation/transition";
import type {
  ReservationMailRecipient,
  ReservationMailRecipientsQuery,
} from "~/query/reservation/reservation-mail-recipients";
import type { UserGroupList, UserGroupListQuery } from "~/query/user/user-group-list";
import {
  changeReservationStatusUseCase,
  type ChangeReservationStatusArgs,
  type ChangeReservationStatusDeps,
} from "./change-reservation-status";

const testNow = new Date("2026-09-20T10:00:00+09:00");

const baseProvisionalReservation: Reservation = {
  id: "res_provisional_01",
  groupId: "grp_robotics",
  facilityId: "fac_room_a",
  startAt: new Date("2026-09-25T10:00:00+09:00"),
  endAt: new Date("2026-09-25T12:00:00+09:00"),
  headCount: 4,
  note: null,
  status: ReservationStatus.Provisional,
  statusReason: null,
  createdBy: "usr_student_01",
  createdAt: new Date("2026-09-20T09:00:00+09:00"),
  updatedAt: new Date("2026-09-20T09:00:00+09:00"),
};

const baseApprovedReservation: Reservation = {
  ...baseProvisionalReservation,
  id: "res_approved_01",
  status: ReservationStatus.Approved,
};

const memberGroups: UserGroupList = [
  {
    id: "grp_robotics",
    name: "ロボティクス開発プロジェクト",
    status: GroupStatus.Enabled,
    roles: [MembershipRole.Member],
  },
];

const otherGroups: UserGroupList = [
  {
    id: "grp_other",
    name: "他団体",
    status: GroupStatus.Enabled,
    roles: [MembershipRole.Member],
  },
];

const defaultRecipients: readonly ReservationMailRecipient[] = [
  {
    userId: "usr_student_01",
    address: "student@example.com",
    name: "学生代表",
  },
];

const createMockDeps = (options?: {
  reservation?: Reservation | null;
  userGroups?: UserGroupList;
  hasOverlap?: boolean;
  /** 条件付き更新が 1 件更新できたか。false は同時操作との競合を表す */
  applied?: boolean;
  recipients?: readonly ReservationMailRecipient[];
}) => {
  const res = options?.reservation !== undefined ? options.reservation : baseProvisionalReservation;
  const groups = options?.userGroups ?? memberGroups;
  const hasOverlap = options?.hasOverlap ?? false;
  const applied = options?.applied ?? true;
  const recipients = options?.recipients ?? defaultRecipients;

  const findById = vi.fn((_id: string) =>
    res
      ? okAsync(res)
      : errAsync({
          code: ReservationErrorCode.ReservationNotFound,
          message: "Reservation not Found",
        }),
  );

  const existsApprovedOverlap = vi.fn((_args: unknown) => okAsync(hasOverlap));
  const applyStatusTransition = vi.fn((_args: unknown, _mails: unknown) => okAsync(applied));
  const create = vi.fn((_res: unknown) => okAsync(null));

  const reservationRepository: ReservationRepository = {
    findById,
    create,
    existsApprovedOverlap,
    applyStatusTransition,
  };

  const findByUserId = vi.fn((_userId: string) => okAsync(groups));
  const userGroupListQuery: UserGroupListQuery = { findByUserId };

  const findByReservationId = vi.fn((_reservationId: string) => okAsync(recipients));
  const reservationMailRecipientsQuery: ReservationMailRecipientsQuery = {
    findByReservationId,
  };

  const deps: ChangeReservationStatusDeps = {
    reservationRepository,
    userGroupListQuery,
    reservationMailRecipientsQuery,
  };

  return {
    deps,
    spies: {
      findById,
      existsApprovedOverlap,
      applyStatusTransition,
      findByUserId,
      findByReservationId,
    },
  };
};

describe("changeReservationStatusUseCase", () => {
  describe("成功パターン（5つの遷移）", () => {
    it("1. 団体メンバーが仮予約を取り消す（provisional → withdrawn）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        reason: "都合がつかなくなったため",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const value = result._unsafeUnwrap();
      expect(value.status).toBe(ReservationStatus.Withdrawn);
      expect(value.statusReason).toBe("都合がつかなくなったため");

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        {
          id: "res_provisional_01",
          expectedStatus: ReservationStatus.Provisional,
          status: ReservationStatus.Withdrawn,
          statusReason: "都合がつかなくなったため",
          updatedAt: testNow,
          requireNoApprovedOverlap: false,
        },
        [],
      );
    });

    it("1b. 団体メンバーが理由なしで仮予約を取り消す（理由は任意）", async () => {
      const { deps } = createMockDeps({ reservation: baseProvisionalReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
        reason: null,
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().statusReason).toBeNull();
    });

    it("2. 団体メンバーが承認済み予約をキャンセルする（approved → cancelled）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseApprovedReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Cancel,
        reason: "イベント延期のため",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const value = result._unsafeUnwrap();
      expect(value.status).toBe(ReservationStatus.Cancelled);
      expect(value.statusReason).toBe("イベント延期のため");

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        {
          id: "res_approved_01",
          expectedStatus: ReservationStatus.Approved,
          status: ReservationStatus.Cancelled,
          statusReason: "イベント延期のため",
          updatedAt: testNow,
          requireNoApprovedOverlap: false,
        },
        [],
      );
    });

    it("3. 事務局が仮予約を承認する（provisional → approved, 重複なし、承認通知メール積立）", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        hasOverlap: false,
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const value = result._unsafeUnwrap();
      expect(value.status).toBe(ReservationStatus.Approved);
      expect(value.statusReason).toBeNull();

      expect(spies.existsApprovedOverlap).toHaveBeenCalledWith({
        facilityId: "fac_room_a",
        startAt: baseProvisionalReservation.startAt,
        endAt: baseProvisionalReservation.endAt,
      });
      expect(spies.findByReservationId).toHaveBeenCalledWith("res_provisional_01");

      // 承認は重なりの確認（COND-001）と通知メール（EVT-005）も更新に含める
      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        {
          id: "res_provisional_01",
          expectedStatus: ReservationStatus.Provisional,
          status: ReservationStatus.Approved,
          statusReason: null,
          updatedAt: testNow,
          requireNoApprovedOverlap: true,
        },
        [
          expect.objectContaining({
            idempotencyKey: "reservation:approved:res_provisional_01:usr_student_01",
            to: { address: "student@example.com", name: "学生代表" },
            subject: expect.stringContaining("承認されました"),
          }),
        ],
      );
    });

    it("3b. 承認時に宛先が複数ある場合は全宛先分の MailDraft が渡される（EVT-005）", async () => {
      const recipients = [
        { userId: "usr_student_01", address: "student@example.com", name: "申請者" },
        { userId: "usr_admin_01", address: "admin1@example.com", name: "管理者1" },
        { userId: "usr_admin_02", address: "admin2@example.com", name: "管理者2" },
      ];
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        recipients,
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({
            idempotencyKey: "reservation:approved:res_provisional_01:usr_student_01",
            to: { address: "student@example.com", name: "申請者" },
          }),
          expect.objectContaining({
            idempotencyKey: "reservation:approved:res_provisional_01:usr_admin_01",
            to: { address: "admin1@example.com", name: "管理者1" },
          }),
          expect.objectContaining({
            idempotencyKey: "reservation:approved:res_provisional_01:usr_admin_02",
            to: { address: "admin2@example.com", name: "管理者2" },
          }),
        ]),
      );
      const passedMails = (spies.applyStatusTransition.mock.calls[0] as unknown[])[1] as unknown[];
      expect(passedMails).toHaveLength(3);
    });

    it("4. 事務局が理由を入力して仮予約を却下する（provisional → rejected, メールなし）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Reject,
        reason: "設備点検のため利用できません",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const value = result._unsafeUnwrap();
      expect(value.status).toBe(ReservationStatus.Rejected);
      expect(value.statusReason).toBe("設備点検のため利用できません");

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        {
          id: "res_provisional_01",
          expectedStatus: ReservationStatus.Provisional,
          status: ReservationStatus.Rejected,
          statusReason: "設備点検のため利用できません",
          updatedAt: testNow,
          requireNoApprovedOverlap: false,
        },
        [],
      );
    });

    it("5. 事務局が理由を入力して承認済み予約をキャンセルする（approved → cancelled_by_staff, メールなし）", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseApprovedReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.StaffCancel,
        reason: "大学の公式行事のため",
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isOk()).toBe(true);

      const value = result._unsafeUnwrap();
      expect(value.status).toBe(ReservationStatus.CancelledByStaff);
      expect(value.statusReason).toBe("大学の公式行事のため");

      expect(spies.applyStatusTransition).toHaveBeenCalledWith(
        {
          id: "res_approved_01",
          expectedStatus: ReservationStatus.Approved,
          status: ReservationStatus.CancelledByStaff,
          statusReason: "大学の公式行事のため",
          updatedAt: testNow,
          requireNoApprovedOverlap: false,
        },
        [],
      );
    });
  });

  describe("失敗パターン", () => {
    it("理由なしの却下は弾かれる（COND-002）", async () => {
      const { deps } = createMockDeps({ reservation: baseProvisionalReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Reject,
        reason: "   ",
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidInput);
      expect(result._unsafeUnwrapErr().message).toContain("却下理由を入力してください");
    });

    it("理由なしの事務局キャンセルは弾かれる（COND-002）", async () => {
      const { deps } = createMockDeps({ reservation: baseApprovedReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.StaffCancel,
        reason: "",
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationInvalidInput);
      expect(result._unsafeUnwrapErr().message).toContain("キャンセル理由を入力してください");
    });

    it("他団体所属のユーザーによる取り消しは拒否される（自団体の突き合わせ）", async () => {
      const { deps } = createMockDeps({
        reservation: baseProvisionalReservation,
        userGroups: otherGroups, // 予約の "grp_robotics" に所属していない
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_other_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationForbidden);
    });

    it("非スタッフによる承認は拒否される", async () => {
      const { deps } = createMockDeps({ reservation: baseProvisionalReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Approve,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationForbidden);
    });

    it("承認時に同一施設・同一時間帯に承認済みの重複予約が存在する場合は拒否される（COND-001）", async () => {
      const { deps, spies } = createMockDeps({
        reservation: baseProvisionalReservation,
        hasOverlap: true, // 重複あり
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationConflict);
      expect(result._unsafeUnwrapErr().message).toContain("先にそちらをキャンセルしてください");
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });

    it("不正な遷移（例: 承認済み予約の取り消し）は拒否される", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseApprovedReservation });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_approved_01",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(
        ReservationErrorCode.ReservationInvalidTransition,
      );
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });

    it("条件付き更新が 0 件だった場合は競合として扱う（同時に別の操作が反映された）", async () => {
      const { deps } = createMockDeps({
        reservation: baseProvisionalReservation,
        applied: false, // 読んでから書くまでの間に、別の操作が先に反映された
      });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationConflict);
      expect(result._unsafeUnwrapErr().message).toContain("読み込み直して");
    });

    it("存在しない予約 ID を指定した場合は NOT_FOUND エラーとなる", async () => {
      const { deps } = createMockDeps({ reservation: null });

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_non_existent",
        actorUserId: "usr_student_01",
        isStaff: false,
        transition: ReservationTransition.Withdraw,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.ReservationNotFound);
    });

    it("宛先取得に失敗した場合は DatabaseError となり applyStatusTransition は呼ばれない", async () => {
      const { deps, spies } = createMockDeps({ reservation: baseProvisionalReservation });
      (deps.reservationMailRecipientsQuery as any).findByReservationId = vi.fn(() =>
        errAsync({ code: "DATABASE_ERROR", message: "DB error" }),
      );

      const args: ChangeReservationStatusArgs = {
        reservationId: "res_provisional_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
        transition: ReservationTransition.Approve,
        now: testNow,
      };

      const result = await changeReservationStatusUseCase(deps, args);
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
      expect(spies.applyStatusTransition).not.toHaveBeenCalled();
    });
  });
});
