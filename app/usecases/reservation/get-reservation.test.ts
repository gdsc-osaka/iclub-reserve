import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import {
  MembershipErrorCode,
  MembershipRole,
  type Membership,
  type MembershipRepository,
} from "~/domain/membership";
import { ReservationErrorCode, ReservationStatus } from "~/domain/reservation";
import { ReservationTransition } from "~/domain/reservation/transition";
import { QueryErrorCode } from "~/query/error";
import type {
  ReservationDetailQuery,
  ReservationDetailRow,
} from "~/query/reservation/reservation-detail";
import type {
  ReservationMessageListQuery,
  ReservationMessageRow,
} from "~/query/reservation/reservation-message-list";
import { getReservationUseCase } from "./get-reservation";

const defaultRow: ReservationDetailRow = {
  id: "rsv_01",
  groupId: "grp_robotics",
  groupName: "ロボット工学研究会",
  facilityName: "会議室A",
  startAt: new Date("2026-09-16T10:00:00+09:00"),
  endAt: new Date("2026-09-16T12:00:00+09:00"),
  headCount: 4,
  note: "週次定例",
  status: ReservationStatus.Provisional,
  statusReason: null,
  createdByName: "山田太郎",
  createdAt: new Date("2026-09-14T09:00:00+09:00"),
  hasApprovedOverlap: false,
  hasProvisionalOverlap: false,
};

const membership: Membership = {
  groupId: "grp_robotics",
  userId: "usr_student_01",
  role: MembershipRole.Member,
};

const createDeps = (
  overrides: {
    row?: ReservationDetailRow | null;
    queryError?: boolean;
    membership?: Membership | null;
    membershipDbError?: boolean;
    messages?: readonly ReservationMessageRow[];
    messageQueryError?: boolean;
  } = {},
) => {
  const findByReservationId = vi.fn((_id: string) => {
    if (overrides.queryError === true) {
      return errAsync({
        code: QueryErrorCode.DatabaseError,
        message: "query failed",
      });
    }
    if (overrides.row === null) {
      return okAsync(null);
    }
    return okAsync(overrides.row ?? defaultRow);
  });

  const findByGroupAndUser = vi.fn((_groupId: string, _userId: string) =>
    overrides.membershipDbError === true
      ? errAsync({ code: MembershipErrorCode.DatabaseError, message: "db down" })
      : okAsync(overrides.membership === undefined ? membership : overrides.membership),
  );

  const listByReservationId = vi.fn((_id: string) => {
    if (overrides.messageQueryError === true) {
      return errAsync({
        code: QueryErrorCode.DatabaseError,
        message: "message query failed",
      });
    }
    return okAsync(overrides.messages ?? []);
  });

  const reservationDetailQuery: ReservationDetailQuery = {
    findByReservationId,
  };

  const reservationMessageListQuery: ReservationMessageListQuery = {
    listByReservationId,
  };

  const membershipRepository: MembershipRepository = {
    findByGroupAndUser,
    countAdmins: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    updateRole: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    remove: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
  };

  return {
    deps: { reservationDetailQuery, membershipRepository, reservationMessageListQuery },
    spies: { findByReservationId, findByGroupAndUser, listByReservationId },
  };
};

describe("getReservationUseCase", () => {
  describe("可視範囲（COND-008）と transitions", () => {
    it("自団体のメンバーには全項目を返し、仮予約なら transitions は withdraw のみ", async () => {
      const { deps } = createDeps();

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(result.isOk()).toBe(true);
      const data = result._unsafeUnwrap();
      expect(data.view.canViewDetail).toBe(true);
      if (data.view.canViewDetail) {
        expect(data.view.reservation).toEqual({
          id: defaultRow.id,
          groupName: defaultRow.groupName,
          facilityName: defaultRow.facilityName,
          startAt: defaultRow.startAt,
          endAt: defaultRow.endAt,
          status: defaultRow.status,
          headCount: defaultRow.headCount,
          note: defaultRow.note,
          statusReason: defaultRow.statusReason,
          createdByName: defaultRow.createdByName,
          createdAt: defaultRow.createdAt,
          hasApprovedOverlap: defaultRow.hasApprovedOverlap,
          hasProvisionalOverlap: defaultRow.hasProvisionalOverlap,
        });
      }
      expect(data.transitions).toEqual([ReservationTransition.Withdraw]);
    });

    it("所属していない事務局には全項目を返し、仮予約なら transitions は承認と却下のみ（取り消しは含まない）", async () => {
      const { deps } = createDeps({ membership: null });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
      });

      expect(result.isOk()).toBe(true);
      const data = result._unsafeUnwrap();
      expect(data.view.canViewDetail).toBe(true);
      expect(data.transitions).toEqual([
        ReservationTransition.Approve,
        ReservationTransition.Reject,
      ]);
    });

    it("所属している事務局には、仮予約なら取り消し・承認・却下のすべてが入る", async () => {
      const { deps } = createDeps({ membership });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
      });

      expect(result.isOk()).toBe(true);
      const data = result._unsafeUnwrap();
      expect(data.transitions).toEqual([
        ReservationTransition.Withdraw,
        ReservationTransition.Approve,
        ReservationTransition.Reject,
      ]);
    });

    it("他団体のユーザーには概要だけを返し、transitions は空", async () => {
      const { deps } = createDeps({ membership: null });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_other_01",
        isStaff: false,
      });

      expect(result.isOk()).toBe(true);
      const data = result._unsafeUnwrap();
      expect(data.view.canViewDetail).toBe(false);
      expect(data.view.reservation).toEqual({
        id: defaultRow.id,
        groupName: defaultRow.groupName,
        facilityName: defaultRow.facilityName,
        startAt: defaultRow.startAt,
        endAt: defaultRow.endAt,
        status: defaultRow.status,
      });
      expect(data.transitions).toEqual([]);
    });

    it("他団体のユーザーに渡す予約には、詳細項目のキー自体が無い", async () => {
      const { deps } = createDeps({ membership: null });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_other_01",
        isStaff: false,
      });

      const view = result._unsafeUnwrap().view;
      const keys = Object.keys(view.reservation);

      expect(keys).not.toContain("headCount");
      expect(keys).not.toContain("note");
      expect(keys).not.toContain("statusReason");
      expect(keys).not.toContain("createdByName");
      expect(keys).not.toContain("createdAt");
      expect(keys).not.toContain("hasApprovedOverlap");
      expect(keys).not.toContain("hasProvisionalOverlap");
    });

    it("groupId は view.reservation のどちらの形にも無い", async () => {
      const { deps: memberDeps } = createDeps();
      const memberResult = await getReservationUseCase(memberDeps, {
        reservationId: "rsv_01",
        actorUserId: "usr_student_01",
        isStaff: false,
      });
      expect(Object.keys(memberResult._unsafeUnwrap().view.reservation)).not.toContain("groupId");

      const { deps: otherDeps } = createDeps({ membership: null });
      const otherResult = await getReservationUseCase(otherDeps, {
        reservationId: "rsv_01",
        actorUserId: "usr_other_01",
        isStaff: false,
      });
      expect(Object.keys(otherResult._unsafeUnwrap().view.reservation)).not.toContain("groupId");
    });

    it("終了した予約では transitions は空になる", async () => {
      for (const status of [
        ReservationStatus.Withdrawn,
        ReservationStatus.Rejected,
        ReservationStatus.Cancelled,
        ReservationStatus.CancelledByStaff,
      ]) {
        const { deps } = createDeps({
          row: { ...defaultRow, status, statusReason: "終了理由" },
        });

        const result = await getReservationUseCase(deps, {
          reservationId: "rsv_01",
          actorUserId: "usr_student_01",
          isStaff: false,
        });

        expect(result._unsafeUnwrap().transitions).toEqual([]);
      }
    });
  });

  describe("所属の引き方", () => {
    it("事務局でも所属を引く（findByGroupAndUser が呼ばれる）", async () => {
      const { deps, spies } = createDeps({ membership: null });

      await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_staff_01",
        isStaff: true,
      });

      expect(spies.findByGroupAndUser).toHaveBeenCalledWith("grp_robotics", "usr_staff_01");
    });

    it("予約が属する団体での所属を引く（row.groupId を渡している）", async () => {
      const { deps, spies } = createDeps();

      await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(spies.findByGroupAndUser).toHaveBeenCalledWith("grp_robotics", "usr_student_01");
    });

    it("所属の確認に失敗したら DatabaseError を返す", async () => {
      const { deps } = createDeps({ membershipDbError: true });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
    });
  });

  describe("失敗の返し方", () => {
    it("Query が DB エラーなら DatabaseError を返す（NotFound に潰さない）", async () => {
      const { deps } = createDeps({ queryError: true });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      const err = result._unsafeUnwrapErr();
      expect(err.code).toBe(ReservationErrorCode.DatabaseError);
      expect(err.cause).toBeDefined();
    });

    it("Query が null なら NotFound を返す", async () => {
      const { deps } = createDeps({ row: null });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_missing",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.NotFound);
    });
  });

  describe("予約 ID の扱い", () => {
    it("空白だけの ID は DB へ問い合わせずに NotFound を返す", async () => {
      const { deps, spies } = createDeps();

      const result = await getReservationUseCase(deps, {
        reservationId: "   ",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.NotFound);
      expect(spies.findByReservationId).not.toHaveBeenCalled();
    });

    it("前後の空白を落としてから Query を呼ぶ", async () => {
      const { deps, spies } = createDeps();

      await getReservationUseCase(deps, {
        reservationId: "  rsv_01  ",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(spies.findByReservationId).toHaveBeenCalledWith("rsv_01");
    });
  });

  describe("予約メッセージの表示（COND-008）", () => {
    const messageRows: readonly ReservationMessageRow[] = [
      {
        id: "msg_01",
        senderId: "usr_student_01",
        senderName: "山田太郎",
        sentAsStaff: false,
        body: "機材をお借りできますか？",
        sentAt: new Date("2026-09-14T10:00:00+09:00"),
      },
      {
        id: "msg_02",
        senderId: "usr_staff_secret_id",
        senderName: "秘密のスタッフ",
        sentAsStaff: true,
        body: "貸出可能です。",
        sentAt: new Date("2026-09-14T11:00:00+09:00"),
      },
    ];

    it("自団体のメンバーが見る：messages がクエリの順のまま返り、事務局送信は「事務局」、結果全体に事務局員の氏名・ID が含まれず senderId キーも無く自分のものだけ isMine: true", async () => {
      const { deps } = createDeps({ messages: messageRows });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(result.isOk()).toBe(true);
      const data = result._unsafeUnwrap();
      expect(data.view.canViewDetail).toBe(true);
      if (!data.view.canViewDetail) return;

      expect(data.view.messages).toHaveLength(2);
      expect(data.view.messages[0]).toEqual({
        id: "msg_01",
        senderLabel: "山田太郎",
        isMine: true,
        body: "機材をお借りできますか？",
        sentAt: messageRows[0].sentAt,
      });
      expect(data.view.messages[1]).toEqual({
        id: "msg_02",
        senderLabel: "事務局",
        isMine: false,
        body: "貸出可能です。",
        sentAt: messageRows[1].sentAt,
      });

      // メッセージに senderId のキーが無い
      expect("senderId" in data.view.messages[0]).toBe(false);
      expect("senderId" in data.view.messages[1]).toBe(false);

      // 結果全体（JSON.stringify）に事務局員の氏名も ID も含まれない
      const json = JSON.stringify(data);
      expect(json).not.toContain("usr_staff_secret_id");
      expect(json).not.toContain("秘密のスタッフ");
    });

    it("所属の無い事務局が見る：事務局としての送信は「<氏名>（事務局）」、団体側の送信は氏名", async () => {
      const { deps } = createDeps({ membership: null, messages: messageRows });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_staff_viewer",
        isStaff: true,
      });

      expect(result.isOk()).toBe(true);
      const data = result._unsafeUnwrap();
      expect(data.view.canViewDetail).toBe(true);
      if (!data.view.canViewDetail) return;

      expect(data.view.messages[0].senderLabel).toBe("山田太郎");
      expect(data.view.messages[1].senderLabel).toBe("秘密のスタッフ（事務局）");
    });

    it("団体に所属している事務局が見る：同じく氏名が見える（事務局として扱う）", async () => {
      const { deps } = createDeps({ membership, messages: messageRows });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_staff_viewer",
        isStaff: true,
      });

      expect(result.isOk()).toBe(true);
      const data = result._unsafeUnwrap();
      expect(data.view.canViewDetail).toBe(true);
      if (!data.view.canViewDetail) return;

      expect(data.view.messages[0].senderLabel).toBe("山田太郎");
      expect(data.view.messages[1].senderLabel).toBe("秘密のスタッフ（事務局）");
    });

    it("他団体の人が見る：listByReservationId が一度も呼ばれず、view に messages のキーが無い", async () => {
      const { deps, spies } = createDeps({ membership: null, messages: messageRows });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_other_01",
        isStaff: false,
      });

      expect(result.isOk()).toBe(true);
      const data = result._unsafeUnwrap();
      expect(data.view.canViewDetail).toBe(false);
      expect(spies.listByReservationId).not.toHaveBeenCalled();
      expect("messages" in data.view).toBe(false);
    });

    it("メッセージの読み取りに失敗したら DatabaseError を返す", async () => {
      const { deps } = createDeps({ messageQueryError: true });

      const result = await getReservationUseCase(deps, {
        reservationId: "rsv_01",
        actorUserId: "usr_student_01",
        isStaff: false,
      });

      expect(result.isErr()).toBe(true);
      const err = result._unsafeUnwrapErr();
      expect(err.code).toBe(ReservationErrorCode.DatabaseError);
      expect(err.message).toBe("メッセージを読み取れなかった。");
    });
  });
});
