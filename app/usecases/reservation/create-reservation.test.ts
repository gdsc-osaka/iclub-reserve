import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { FacilityErrorCode, type Facility, type FacilityRepository } from "~/domain/facility";
import { GroupErrorCode, GroupStatus, type Group, type GroupRepository } from "~/domain/group";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import type { ReservationMailAudience } from "~/domain/mail/reservation-mail";
import {
  MembershipErrorCode,
  MembershipRole,
  type Membership,
  type MembershipRepository,
} from "~/domain/membership";
import {
  ReservationErrorCode,
  ReservationField,
  ReservationStatus,
  type Reservation,
  type ReservationRepository,
} from "~/domain/reservation";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type { ReservationMailRecipientsQuery } from "~/query/reservation/reservation-mail-recipients";
import { createProvisionalReservationUseCase } from "./create-reservation";

const enabledGroup: Group = {
  id: "grp_robotics",
  name: "ロボティクス開発プロジェクト",
  status: GroupStatus.Enabled,
  createdAt: new Date("2026-04-01T00:00:00+09:00"),
  updatedAt: new Date("2026-04-01T00:00:00+09:00"),
};

const activeFacility: Facility = {
  id: "fac_meeting_a",
  name: "会議室 A",
  description: null,
  isActive: true,
  createdAt: new Date("2026-04-01T00:00:00+09:00"),
  updatedAt: new Date("2026-04-01T00:00:00+09:00"),
};

const membership: Membership = {
  groupId: "grp_robotics",
  userId: "usr_student_01",
  role: MembershipRole.Member,
};

/** 判定の基準になる「いま」。2026 年 9 月 14 日（月）の 9 時 */
const now = new Date("2026-09-14T09:00:00+09:00");

const args = {
  actorUserId: "usr_student_01",
  isStaff: false,
  now,
  reservation: {
    facilityId: "fac_meeting_a",
    groupId: "grp_robotics",
    startAt: new Date("2026-09-16T10:00:00+09:00"),
    endAt: new Date("2026-09-16T12:00:00+09:00"),
    headCount: 4,
    note: "週次定例",
  },
};

const defaultAudience: ReservationMailAudience = {
  groupMembers: [
    { userId: "usr_student_01", address: "student@example.com", name: "申請者" },
    { userId: "usr_admin_01", address: "admin@example.com", name: "団体管理者" },
  ],
  staff: [{ userId: "usr_staff_01", address: "staff@example.com", name: "事務局員" }],
};

const createDeps = (
  overrides: {
    membership?: Membership | null;
    group?: Group;
    groupNotFound?: boolean;
    facility?: Facility;
    facilityNotFound?: boolean;
    hasApprovedOverlap?: boolean;
    audience?: ReservationMailAudience;
    recipientsQueryError?: QueryError;
    enqueuedMailIds?: readonly string[];
  } = {},
) => {
  const create = vi.fn((_reservation: Reservation, _mails: readonly MailDraft[]) =>
    okAsync({
      enqueuedMailIds: overrides.enqueuedMailIds ?? ["mail_01", "mail_02", "mail_03"],
    }),
  );

  const reservationRepository: ReservationRepository = {
    findById: () => errAsync({ code: ReservationErrorCode.NotFound, message: "not found" }),
    create,
    existsApprovedOverlap: () => okAsync(overrides.hasApprovedOverlap ?? false),
    applyStatusTransition: () => okAsync({ applied: true, enqueuedMailIds: [] }),
  };

  const membershipRepository: MembershipRepository = {
    findByGroupAndUser: () =>
      okAsync(overrides.membership === undefined ? membership : overrides.membership),
    // このテストでは呼ばれない前提。呼ばれたら失敗して気付けるようにしてある
    countAdmins: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    updateRole: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
    remove: () =>
      errAsync({ code: MembershipErrorCode.DatabaseError, message: "このテストでは使わない" }),
  };

  const groupRepository: GroupRepository = {
    findById: () =>
      overrides.groupNotFound === true
        ? errAsync({ code: GroupErrorCode.NotFound, message: "not found" })
        : okAsync(overrides.group ?? enabledGroup),
    // このテストでは呼ばれない前提。呼ばれたら失敗して気付けるようにしてある
    updateName: () =>
      errAsync({ code: GroupErrorCode.DatabaseError, message: "このテストでは使わない" }),
    create: () =>
      errAsync({ code: GroupErrorCode.DatabaseError, message: "このテストでは create は使わない" }),
  };

  const facilityRepository: FacilityRepository = {
    findById: () =>
      overrides.facilityNotFound === true
        ? errAsync({ code: FacilityErrorCode.FacilityNotFound, message: "not found" })
        : okAsync(overrides.facility ?? activeFacility),
  };

  const findForNewReservation = vi.fn((_args: { groupId: string; applicantUserId: string }) =>
    overrides.recipientsQueryError
      ? errAsync(overrides.recipientsQueryError)
      : okAsync(overrides.audience ?? defaultAudience),
  );

  const reservationMailRecipientsQuery: ReservationMailRecipientsQuery = {
    findByReservationId: () =>
      errAsync({ code: QueryErrorCode.NotFound, message: "not implemented in this mock" }),
    findForNewReservation,
  };

  const notifyEnqueued = vi.fn((_outboxIds: readonly string[]) => {});

  return {
    deps: {
      reservationRepository,
      membershipRepository,
      groupRepository,
      facilityRepository,
      reservationMailRecipientsQuery,
      mailOutboxNotifier: { notifyEnqueued },
    },
    create,
    findForNewReservation,
    notifyEnqueued,
  };
};

describe("createProvisionalReservationUseCase", () => {
  it("必ず仮予約として作り、EVT-001 の MailDraft が渡り、積んだ ID が配送に依頼される", async () => {
    const { deps, create, findForNewReservation, notifyEnqueued } = createDeps();

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.reservationId).toBeDefined();

    // outbox に積んだ ID がそのまま即時配送の依頼に渡ること（ADR-002 決定 1）
    expect(notifyEnqueued).toHaveBeenCalledWith(["mail_01", "mail_02", "mail_03"]);

    // STATE-001: 申請から生まれる予約は必ず仮予約
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      status: ReservationStatus.Provisional,
      statusReason: null,
      createdBy: "usr_student_01",
      facilityId: "fac_meeting_a",
      headCount: 4,
    });

    // 宛先クエリが正しく呼ばれていること
    expect(findForNewReservation).toHaveBeenCalledWith({
      groupId: "grp_robotics",
      applicantUserId: "usr_student_01",
    });

    // EVT-001 の MailDraft が生成されて渡されていること（申請者・管理者・事務局の 3 通）
    const mails = create.mock.calls[0]?.[1];
    expect(mails).toHaveLength(3);
    expect(mails?.[0]?.idempotencyKey).toMatch(/^reservation:applied:.*:usr_student_01$/);
    expect(mails?.[1]?.idempotencyKey).toMatch(/^reservation:applied:.*:usr_admin_01$/);
    expect(mails?.[2]?.idempotencyKey).toMatch(/^reservation:applied:.*:usr_staff_01$/);
    expect(mails?.[0]?.subject).toBe("【i-Club予約システム】施設・設備の利用予約が申請されました");
    expect(mails?.[0]?.text).toContain("施設・設備の利用予約が申請されました。");
  });

  it("所属していない団体では申請できず、宛先クエリも呼ばれない", async () => {
    const { deps, create, findForNewReservation } = createDeps({ membership: null });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
    expect(findForNewReservation).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("事務局は所属していない団体でも申請できる", async () => {
    // COND-009: 事務局の権限は団体内の役割とは別の軸で、所属していなくても成立する
    const { deps, create, findForNewReservation } = createDeps({ membership: null });

    const result = await createProvisionalReservationUseCase(deps, {
      ...args,
      actorUserId: "usr_staff_01",
      isStaff: true,
    });

    expect(result.isOk()).toBe(true);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ createdBy: "usr_staff_01" });
    expect(findForNewReservation).toHaveBeenCalled();
  });

  it("承認待ちの団体からは申請できず、宛先クエリも呼ばれない", async () => {
    // COND-006: 申請できるのは事務局が有効にした団体だけ
    const { deps, create, findForNewReservation } = createDeps({
      group: { ...enabledGroup, status: GroupStatus.Pending },
    });

    const result = await createProvisionalReservationUseCase(deps, args);

    // 申請フォームが団体の欄の下に出せるよう、どの項目についての失敗かを添える（ADR-004 決定 6）
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.GroupNotEligible,
      field: ReservationField.Group,
    });
    expect(findForNewReservation).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("事務局でも、無効な団体としては申請できず、宛先クエリも呼ばれない", async () => {
    const { deps, findForNewReservation } = createDeps({
      group: { ...enabledGroup, status: GroupStatus.Disabled },
    });

    const result = await createProvisionalReservationUseCase(deps, { ...args, isStaff: true });

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.GroupNotEligible);
    expect(findForNewReservation).not.toHaveBeenCalled();
  });

  it("存在しない団体では申請できず、宛先クエリも呼ばれない", async () => {
    const { deps, findForNewReservation } = createDeps({ groupNotFound: true });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.GroupNotEligible);
    expect(findForNewReservation).not.toHaveBeenCalled();
  });

  it("無効になっている施設・設備では申請できず、宛先クエリも呼ばれない", async () => {
    const { deps, create, findForNewReservation } = createDeps({
      facility: { ...activeFacility, isActive: false },
    });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.FacilityNotAvailable,
      field: ReservationField.Facility,
    });
    expect(findForNewReservation).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("事務局でも、無効になっている施設・設備では申請できず、宛先クエリも呼ばれない", async () => {
    const { deps, findForNewReservation } = createDeps({
      facility: { ...activeFacility, isActive: false },
    });

    const result = await createProvisionalReservationUseCase(deps, { ...args, isStaff: true });

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.FacilityNotAvailable);
    expect(findForNewReservation).not.toHaveBeenCalled();
  });

  it("存在しない施設・設備では申請できず、宛先クエリも呼ばれない", async () => {
    const { deps, create, findForNewReservation } = createDeps({ facilityNotFound: true });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.FacilityNotAvailable);
    expect(findForNewReservation).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("承認済みの予約と重なる時間帯では申請できず、宛先クエリも呼ばれない", async () => {
    // COND-001: 同一施設・同一時間帯に承認済みの予約があってはならない
    const { deps, create, findForNewReservation } = createDeps({ hasApprovedOverlap: true });

    const result = await createProvisionalReservationUseCase(deps, args);

    // 重なりは時間帯を選び直せば通るので、利用時間についての失敗として返す
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: ReservationErrorCode.Conflict,
      field: ReservationField.Period,
    });
    expect(findForNewReservation).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("過ぎた日時では申請できず、宛先クエリも呼ばれない", async () => {
    const { deps, create, findForNewReservation } = createDeps();

    const result = await createProvisionalReservationUseCase(deps, {
      ...args,
      reservation: {
        ...args.reservation,
        startAt: new Date("2026-09-13T10:00:00+09:00"),
        endAt: new Date("2026-09-13T12:00:00+09:00"),
      },
    });

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.InvalidPeriod);
    expect(findForNewReservation).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("所属していない人には、団体が有効かどうかを知らせない（宛先クエリも呼ばれない）", async () => {
    const { deps, findForNewReservation } = createDeps({
      membership: null,
      group: { ...enabledGroup, status: GroupStatus.Disabled },
    });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.Forbidden);
    expect(findForNewReservation).not.toHaveBeenCalled();
  });

  it("宛先クエリが失敗したら DatabaseError になり、create が呼ばれないこと", async () => {
    const { deps, create, findForNewReservation } = createDeps({
      recipientsQueryError: {
        code: QueryErrorCode.DatabaseError,
        message: "Failed to query recipients",
      },
    });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe(ReservationErrorCode.DatabaseError);
    expect(findForNewReservation).toHaveBeenCalledWith({
      groupId: "grp_robotics",
      applicantUserId: "usr_student_01",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("即時配送の依頼が例外を投げても、予約の作成は成功として返す（ADR-002 決定 1）", async () => {
    /*
     * ポートの取り決めでは notifyEnqueued は失敗を返さないが、実装が約束を破った場合に
     * 「DB には入っているのに画面はエラー」になると、利用者は同じ内容をもう一度申請してしまう。
     * 依頼の失敗が業務処理を巻き込まないことを、ここで固定しておく。
     */
    const { deps, notifyEnqueued } = createDeps();
    notifyEnqueued.mockImplementation(() => {
      throw new Error("queue is unavailable");
    });

    const result = await createProvisionalReservationUseCase(deps, args);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().reservationId).toBeDefined();
  });
});
