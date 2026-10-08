import { AuditLogAction, AuditLogTargetType } from "~/domain/audit-log";
import { TERMS_OF_SERVICE } from "~/domain/authn/terms-of-service";
import { InvitationStatus, invitationExpiresAt } from "~/domain/invitation";
import { ReservationStatus } from "~/domain/reservation";
import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import * as schema from "~/db/schema";
import { addDays, atTokyoTime, startOfTokyoWeek } from "~/lib/date";

/**
 * 施設・備品のシードデータ
 */
export const seedFacilities: (typeof schema.facilityTable.$inferInsert)[] = [
  {
    id: "fac_meeting_a",
    name: "ミーティングルーム A",
    description: "定員8名。ホワイトボード・大型ディスプレイ常設。",
    photoUrl: null,
    googleCalendarId: null,
    calendarUrl: null,
    isActive: true,
  },
  {
    id: "fac_meeting_b",
    name: "ミーティングルーム B",
    description: "定員12名。プロジェクター対応。",
    photoUrl: null,
    googleCalendarId: null,
    calendarUrl: null,
    isActive: true,
  },
  {
    id: "fac_event_hall",
    name: "イベントホール",
    description: "定員50名。全体ミーティングやワークショップ用スペース。",
    photoUrl: null,
    googleCalendarId: null,
    calendarUrl: null,
    isActive: true,
  },
  {
    id: "fac_projector_1",
    name: "モバイルプロジェクター 1号機",
    description: "Anker Nebula Capsule II（可搬式）",
    photoUrl: null,
    googleCalendarId: null,
    calendarUrl: null,
    isActive: true,
  },
  {
    id: "fac_vr_set",
    name: "Meta Quest 3 (VR機材)",
    description: "VR開発・実証実験用ヘッドセット",
    photoUrl: null,
    googleCalendarId: null,
    calendarUrl: null,
    isActive: true,
  },
];

/**
 * テスト用ユーザーのシードデータ。
 * 大阪大学の許可ドメイン（@osaka-u.ac.jp / @*.osaka-u.ac.jp）に準拠。
 *
 * 1 人ずつ「どの立場の人か」を名前で引けるようにしている。
 * E2E テスト（`e2e/`）は `seedPersonas.groupMember` のように立場で人を選ぶので、
 * ID やメールアドレスを書き換えてもテストは直さなくてよい。
 * 逆に、立場（所属する団体・役割・事務局かどうか）を変えるとテストが落ちるので、
 * 変えるときは `e2e/` も合わせて確かめること。
 */
export const seedPersonas = {
  /** 事務局スタッフ。どの団体にも入っていない */
  staff: {
    id: "usr_staff_01",
    name: "管理者スタッフ",
    email: "staff@osaka-u.ac.jp",
    emailVerified: true,
    image: null,
    is_staff: true,
  },
  /** 有効な団体「ロボティクス開発プロジェクト」の管理者。承認待ちの団体にも一般メンバーとして入っている */
  groupAdmin: {
    id: "usr_student_01",
    name: "阪大 太郎 (学生オーナー)",
    email: "taro@ecs.osaka-u.ac.jp",
    emailVerified: true,
    image: null,
    is_staff: false,
  },
  /** 有効な団体「ロボティクス開発プロジェクト」の一般メンバー */
  groupMember: {
    id: "usr_student_02",
    name: "阪大 花子 (学生メンバー)",
    email: "hanako@ecs.osaka-u.ac.jp",
    emailVerified: true,
    image: null,
    is_staff: false,
  },
  /** どの団体にも入っていない人。ダッシュボードが空のときの見え方を確かめられる */
  noGroupUser: {
    id: "usr_student_03",
    name: "阪大 次郎 (未所属)",
    email: "jiro@ecs.osaka-u.ac.jp",
    emailVerified: true,
    image: null,
    is_staff: false,
  },
  /**
   * 承認待ちの団体「AI ハッカソンチーム」だけに入っている管理者。
   * 承認待ちの団体は予約を申請できない（COND-006）ので、申請の導線が出ないことを確かめられる。
   */
  pendingGroupAdmin: {
    id: "usr_student_04",
    name: "阪大 三郎 (承認待ちの団体の管理者)",
    email: "saburo@ecs.osaka-u.ac.jp",
    emailVerified: true,
    image: null,
    is_staff: false,
  },
} as const satisfies Record<string, typeof schema.user.$inferInsert>;

/**
 * 投入するユーザー。全員、今の版の利用規約に同意済みとして入れる（REQ-033）。
 * 同意していないと、ログインのたびに初回設定（SCR-014）の同意の段階へ案内されてしまうため。
 */
export const seedUsers: (typeof schema.user.$inferInsert)[] = Object.values(seedPersonas).map(
  (persona) => ({
    ...persona,
    terms_version: TERMS_OF_SERVICE.version,
    terms_accepted_at: new Date(),
  }),
);

/**
 * サンプル団体のシードデータ
 */
export const seedGroups: (typeof schema.groupTable.$inferInsert)[] = [
  {
    id: "grp_robotics",
    name: "ロボティクス開発プロジェクト",
    createdAt: new Date(),
    updatedAt: new Date(),
    status: GroupStatus.Enabled,
  },
  {
    id: "grp_ai_hackers",
    name: "AI ハッカソンチーム",
    createdAt: new Date(),
    updatedAt: new Date(),
    status: GroupStatus.Pending,
  },
  {
    id: "grp_disabled_group",
    name: "無効化された団体",
    createdAt: new Date(),
    updatedAt: new Date(),
    status: GroupStatus.Disabled,
  },
];

/**
 * 団体メンバーシップのシードデータ
 */
export const seedGroupMembers: (typeof schema.groupMemberTable.$inferInsert)[] = [
  {
    id: "mem_taro_robotics",
    groupId: "grp_robotics",
    userId: "usr_student_01",
    role: MembershipRole.Admin,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "mem_hanako_robotics",
    groupId: "grp_robotics",
    userId: "usr_student_02",
    role: MembershipRole.Member,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "mem_taro_ai",
    groupId: "grp_ai_hackers",
    userId: "usr_student_01",
    role: MembershipRole.Member,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "mem_saburo_ai",
    groupId: "grp_ai_hackers",
    userId: "usr_student_04",
    role: MembershipRole.Admin,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

/**
 * 承諾待ちの招待のシードデータ。
 *
 * 招待の承諾画面（SCR-016）をローカルで開けるようにするためのもの。
 * 花子は「AI ハッカソンチーム」に所属していないので、承諾すると実際にメンバーが増える。
 * 有効期限は運用と同じ規則（`invitationExpiresAt`）で決める。ここで独自の値を書くと、
 * 期限の考え方が 2 か所に散ってしまう。
 */
export const seedGroupInvitations: (typeof schema.groupInvitationTable.$inferInsert)[] = [
  {
    id: "inv_seed_hanako_ai",
    groupId: "grp_ai_hackers",
    email: "hanako@ecs.osaka-u.ac.jp",
    role: MembershipRole.Member,
    status: InvitationStatus.Pending,
    expiresAt: invitationExpiresAt(new Date()),
    createdAt: new Date(),
    // 招待を送れるのは管理者だけなので、この団体の管理者（三郎）が送ったことにする
    inviterId: "usr_student_04",
  },
];

/**
 * 事務局招待のシードデータ（SCR-019 の動作確認用）。
 *
 * 事務局管理画面（SCR-019）の承諾待ち一覧が空にならないようにするためのもの。
 * 宛先は既存のシード利用者と重ならない osaka-u.ac.jp のアドレスにする。
 */
export const seedStaffInvitations: (typeof schema.staffInvitationTable.$inferInsert)[] = [
  {
    id: "staff_inv_seed_01",
    email: "substaff@osaka-u.ac.jp",
    status: InvitationStatus.Pending,
    expiresAt: invitationExpiresAt(new Date()),
    createdAt: new Date(),
    inviterId: "usr_staff_01",
  },
];

/**
 * サンプル予約のシードデータ
 *
 * 日時は「今週の月曜」を起点に組み立てている。
 * 実行した日に関わらず、空き状況カレンダー（SCR-001）の初期表示に
 * かならず予約が並ぶようにするため。
 * 時刻は施設の利用可能時間（FACILITY_OPEN_HOUR〜FACILITY_CLOSE_HOUR）の中に収める。
 */
const weekStart = startOfTokyoWeek(new Date());

/** 今週の月曜から days 日後の、日本時間 hour 時 */
const atWeek = (days: number, hour: number) => atTokyoTime(addDays(weekStart, days), hour);

export const seedReservations: (typeof schema.reservationTable.$inferInsert)[] = [
  {
    id: "res_sample_approved",
    groupId: "grp_robotics",
    facilityId: "fac_meeting_a",
    startAt: atWeek(1, 10),
    endAt: atWeek(1, 12),
    headCount: 4,
    note: "週次プロジェクト定例ミーティング",
    status: ReservationStatus.Approved,
    statusReason: null,
    createdBy: "usr_student_01",
  },
  {
    id: "res_sample_provisional",
    groupId: "grp_ai_hackers",
    facilityId: "fac_event_hall",
    startAt: atWeek(3, 13),
    endAt: atWeek(3, 17),
    headCount: 20,
    note: "AI勉強会＆ハッカソンキックオフ",
    status: ReservationStatus.Provisional,
    statusReason: null,
    createdBy: "usr_student_01",
  },
  /*
   * 重なった仮予約。COND-001 が重複を禁じているのは承認済みの予約に対してだけなので、
   * 仮予約どうしは同じ時間帯に並ぶことがある。
   * カレンダーが帯を横に分けて描けているかは、この 2 件で確かめられる。
   */
  {
    id: "res_overlap_robotics",
    groupId: "grp_robotics",
    facilityId: "fac_meeting_a",
    startAt: atWeek(2, 14),
    endAt: atWeek(2, 16),
    headCount: 6,
    note: "ハードウェア班のレビュー",
    status: ReservationStatus.Provisional,
    statusReason: null,
    createdBy: "usr_student_01",
  },
  {
    id: "res_overlap_ai",
    groupId: "grp_ai_hackers",
    facilityId: "fac_meeting_a",
    startAt: atWeek(2, 15),
    endAt: atWeek(2, 18),
    headCount: 8,
    note: "モデルの評価会",
    status: ReservationStatus.Provisional,
    statusReason: null,
    createdBy: "usr_student_01",
  },
  /*
   * 終了した予約。空き状況カレンダーには出ない（calendarVisibleStatuses）。
   * 却下された枠が埋まって見えていないかを確かめるために入れている。
   */
  {
    id: "res_rejected",
    groupId: "grp_robotics",
    facilityId: "fac_meeting_a",
    startAt: atWeek(3, 10),
    endAt: atWeek(3, 12),
    headCount: 4,
    note: "別の団体と重なったため却下された枠",
    status: ReservationStatus.Rejected,
    statusReason: "同じ時間帯に承認済みの予約があります",
    createdBy: "usr_student_01",
  },
  /*
   * 未来（upcoming）の終了ステータス予約
   */
  {
    id: "res_future_withdrawn",
    groupId: "grp_robotics",
    facilityId: "fac_meeting_b",
    startAt: atWeek(4, 10),
    endAt: atWeek(4, 12),
    headCount: 3,
    note: "都合により申請を取り消した枠",
    status: ReservationStatus.Withdrawn,
    statusReason: null,
    createdBy: "usr_student_01",
  },
  {
    id: "res_future_cancelled",
    groupId: "grp_robotics",
    facilityId: "fac_meeting_a",
    startAt: atWeek(5, 13),
    endAt: atWeek(5, 15),
    headCount: 5,
    note: "メンバー都合によりキャンセルした枠",
    status: ReservationStatus.Cancelled,
    statusReason: "体調不良のため延期",
    createdBy: "usr_student_01",
  },
  {
    id: "res_future_cancelled_by_staff",
    groupId: "grp_ai_hackers",
    facilityId: "fac_event_hall",
    startAt: atWeek(6, 14),
    endAt: atWeek(6, 18),
    headCount: 15,
    note: "大学行事のため事務局によりキャンセルされた枠",
    status: ReservationStatus.CancelledByStaff,
    statusReason: "大学公式イベントの開催に伴う会場占有のため",
    createdBy: "usr_student_01",
  },
  /*
   * 過去（past）の予約データ（6ステータス）
   */
  {
    id: "res_past_approved",
    groupId: "grp_robotics",
    facilityId: "fac_meeting_a",
    startAt: atWeek(-7, 10),
    endAt: atWeek(-7, 12),
    headCount: 4,
    note: "先週のプロジェクト定例ミーティング",
    status: ReservationStatus.Approved,
    statusReason: null,
    createdBy: "usr_student_01",
  },
  {
    id: "res_past_provisional",
    groupId: "grp_ai_hackers",
    facilityId: "fac_meeting_b",
    startAt: atWeek(-6, 13),
    endAt: atWeek(-6, 15),
    headCount: 6,
    note: "過去の仮予約サンプル",
    status: ReservationStatus.Provisional,
    statusReason: null,
    createdBy: "usr_student_01",
  },
  {
    id: "res_past_withdrawn",
    groupId: "grp_robotics",
    facilityId: "fac_projector_1",
    startAt: atWeek(-5, 14),
    endAt: atWeek(-5, 16),
    headCount: 2,
    note: "過去に取り消した備品予約",
    status: ReservationStatus.Withdrawn,
    statusReason: null,
    createdBy: "usr_student_01",
  },
  {
    id: "res_past_rejected",
    groupId: "grp_robotics",
    facilityId: "fac_event_hall",
    startAt: atWeek(-4, 10),
    endAt: atWeek(-4, 12),
    headCount: 25,
    note: "利用規約に合致せず却下された過去枠",
    status: ReservationStatus.Rejected,
    statusReason: "利用目的の記載が不十分なため",
    createdBy: "usr_student_01",
  },
  {
    id: "res_past_cancelled",
    groupId: "grp_ai_hackers",
    facilityId: "fac_meeting_a",
    startAt: atWeek(-3, 15),
    endAt: atWeek(-3, 17),
    headCount: 4,
    note: "過去にキャンセルした枠",
    status: ReservationStatus.Cancelled,
    statusReason: "都合がつかなくなったため",
    createdBy: "usr_student_01",
  },
  {
    id: "res_past_cancelled_by_staff",
    groupId: "grp_robotics",
    facilityId: "fac_vr_set",
    startAt: atWeek(-2, 13),
    endAt: atWeek(-2, 15),
    headCount: 2,
    note: "機材メンテナンスのため事務局キャンセルされた枠",
    status: ReservationStatus.CancelledByStaff,
    statusReason: "機材故障による緊急メンテナンスのため",
    createdBy: "usr_student_01",
  },
];

/**
 * 操作履歴のシードデータ（SCR-018 の動作確認用）。
 *
 * 記録の書き込み（COND-013）はまだ無いので、上の団体・招待・メンバーシップ・予約・施設に
 * 実際に起きたことにして並べている。対象の種類 6 つがすべて現れ、事務局権限による操作とそうでない操作、
 * 「旧 → 新」が出る記録を含む。`changes` の書き方は `AuditLogChanges` の約束に従う。
 */
const seedNow = new Date();

export const seedAuditLogs: (typeof schema.auditLogTable.$inferInsert)[] = [
  {
    id: "log_seed_group_create",
    occurredAt: addDays(seedNow, -30),
    actorId: "usr_student_01",
    actedAsStaff: false,
    action: AuditLogAction.GroupCreate,
    targetType: AuditLogTargetType.Group,
    targetId: "grp_robotics",
    groupId: "grp_robotics",
    changes: {
      name: { before: null, after: "ロボティクス開発プロジェクト" },
      status: { before: null, after: GroupStatus.Pending },
    },
  },
  {
    id: "log_seed_group_enable",
    occurredAt: addDays(seedNow, -29),
    actorId: "usr_staff_01",
    actedAsStaff: true,
    action: AuditLogAction.GroupEnable,
    targetType: AuditLogTargetType.Group,
    targetId: "grp_robotics",
    groupId: "grp_robotics",
    changes: {
      status: { before: GroupStatus.Pending, after: GroupStatus.Enabled },
      status_reason: { before: null, after: null },
    },
  },
  {
    // 却下された過去の予約（res_past_rejected）は、利用日の 2 日前に却下されたことにする
    id: "log_seed_reservation_reject",
    occurredAt: addDays(atWeek(-4, 10), -2),
    actorId: "usr_staff_01",
    actedAsStaff: true,
    action: AuditLogAction.ReservationReject,
    targetType: AuditLogTargetType.Reservation,
    targetId: "res_past_rejected",
    groupId: "grp_robotics",
    changes: {
      status: { before: ReservationStatus.Provisional, after: ReservationStatus.Rejected },
      status_reason: { before: null, after: "利用目的の記載が不十分なため" },
    },
  },
  {
    id: "log_seed_membership_change_role",
    occurredAt: addDays(seedNow, -7),
    actorId: "usr_student_04",
    actedAsStaff: false,
    action: AuditLogAction.MembershipChangeRole,
    targetType: AuditLogTargetType.Membership,
    targetId: "mem_taro_ai",
    groupId: "grp_ai_hackers",
    changes: {
      // 誰のメンバーシップかを示すため、変わらない user_id も残す
      user_id: { before: "usr_student_01", after: "usr_student_01" },
      role: { before: MembershipRole.Admin, after: MembershipRole.Member },
    },
  },
  {
    id: "log_seed_facility_update",
    occurredAt: addDays(seedNow, -6),
    actorId: "usr_staff_01",
    actedAsStaff: true,
    action: AuditLogAction.FacilityUpdate,
    targetType: AuditLogTargetType.Facility,
    targetId: "fac_vr_set",
    groupId: null,
    changes: {
      description: { before: "VR 体験用ヘッドセット", after: "VR開発・実証実験用ヘッドセット" },
    },
  },
  {
    id: "log_seed_facility_deactivate",
    occurredAt: addDays(seedNow, -5),
    actorId: "usr_staff_01",
    actedAsStaff: true,
    action: AuditLogAction.FacilityDeactivate,
    targetType: AuditLogTargetType.Facility,
    targetId: "fac_vr_set",
    groupId: null,
    changes: {
      is_active: { before: true, after: false },
    },
  },
  {
    id: "log_seed_facility_reactivate",
    occurredAt: addDays(seedNow, -4),
    actorId: "usr_staff_01",
    actedAsStaff: true,
    action: AuditLogAction.FacilityReactivate,
    targetType: AuditLogTargetType.Facility,
    targetId: "fac_vr_set",
    groupId: null,
    changes: {
      is_active: { before: false, after: true },
    },
  },
  {
    // 予約（res_sample_approved）は、利用日の 6 日前に申請され、5 日前に承認されたことにする
    id: "log_seed_reservation_apply",
    occurredAt: addDays(atWeek(1, 10), -6),
    actorId: "usr_student_01",
    actedAsStaff: false,
    action: AuditLogAction.ReservationApply,
    targetType: AuditLogTargetType.Reservation,
    targetId: "res_sample_approved",
    groupId: "grp_robotics",
    changes: {
      facility_id: { before: null, after: "fac_meeting_a" },
      start_at: { before: null, after: atWeek(1, 10).toISOString() },
      end_at: { before: null, after: atWeek(1, 12).toISOString() },
      head_count: { before: null, after: 4 },
      note: { before: null, after: "週次プロジェクト定例ミーティング" },
      status: { before: null, after: ReservationStatus.Provisional },
    },
  },
  {
    id: "log_seed_reservation_approve",
    occurredAt: addDays(atWeek(1, 10), -5),
    actorId: "usr_staff_01",
    actedAsStaff: true,
    action: AuditLogAction.ReservationApprove,
    targetType: AuditLogTargetType.Reservation,
    targetId: "res_sample_approved",
    groupId: "grp_robotics",
    changes: {
      status: { before: ReservationStatus.Provisional, after: ReservationStatus.Approved },
      status_reason: { before: null, after: null },
    },
  },
  {
    id: "log_seed_invitation_send",
    occurredAt: addDays(seedNow, -1),
    actorId: "usr_student_04",
    actedAsStaff: false,
    action: AuditLogAction.InvitationSend,
    targetType: AuditLogTargetType.Invitation,
    targetId: "inv_seed_hanako_ai",
    groupId: "grp_ai_hackers",
    changes: {
      email: { before: null, after: "hanako@ecs.osaka-u.ac.jp" },
      role: { before: null, after: MembershipRole.Member },
    },
  },
  {
    // 事務局招待（INFO-009）への招待操作の履歴
    id: "log_seed_staff_role_invite",
    occurredAt: seedNow,
    actorId: "usr_staff_01",
    actedAsStaff: true,
    action: AuditLogAction.StaffRoleInvite,
    targetType: AuditLogTargetType.StaffRole,
    targetId: "staff_inv_seed_01",
    groupId: null,
    changes: {
      email: { before: null, after: "substaff@osaka-u.ac.jp" },
    },
  },
];

/**
 * 予約へのメッセージのシードデータ（SCR-005 の動作確認用）。
 *
 * 承認済みの予約（res_sample_approved）に、一般メンバーの問い合わせ・事務局の返信・管理者のお礼を並べている。
 * 事務局（どの団体にも入っていない）の返信だけが事務局としての送信（sentAsStaff: true）なので、
 * 団体の人で開くと送信者が「事務局」と出て、事務局で開くと「<氏名>（事務局）」と出る（COND-008）。
 * 返信には途中の改行を入れてあり、本文の改行がそのまま出ることも確かめられる。
 */
export const seedReservationMessages: (typeof schema.reservationMessageTable.$inferInsert)[] = [
  {
    id: "msg_seed_01",
    reservationId: "res_sample_approved",
    senderId: "usr_student_02",
    sentAsStaff: false,
    body: "当日はプロジェクターをお借りできますでしょうか？",
    sentAt: addDays(seedNow, -3),
  },
  {
    id: "msg_seed_02",
    reservationId: "res_sample_approved",
    senderId: "usr_staff_01",
    sentAsStaff: true,
    body: "プロジェクターはご利用いただけます。\n当日、受付でお申し付けください。",
    sentAt: addDays(seedNow, -2),
  },
  {
    id: "msg_seed_03",
    reservationId: "res_sample_approved",
    senderId: "usr_student_01",
    sentAsStaff: false,
    body: "承知いたしました。ご準備ありがとうございます。",
    sentAt: addDays(seedNow, -1),
  },
];
