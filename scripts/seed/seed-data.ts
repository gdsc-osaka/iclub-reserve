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
 * テスト用ユーザーのシードデータ
 * 大阪大学の許可ドメイン（@osaka-u.ac.jp / @*.osaka-u.ac.jp）に準拠
 */
export const seedUsers: (typeof schema.user.$inferInsert)[] = [
  {
    id: "usr_staff_01",
    name: "管理者スタッフ",
    email: "staff@osaka-u.ac.jp",
    emailVerified: true,
    image: null,
    is_staff: true,
  },
  {
    id: "usr_student_01",
    name: "阪大 太郎 (学生オーナー)",
    email: "taro@ecs.osaka-u.ac.jp",
    emailVerified: true,
    image: null,
    is_staff: false,
  },
  {
    id: "usr_student_02",
    name: "阪大 花子 (学生メンバー)",
    email: "hanako@ecs.osaka-u.ac.jp",
    emailVerified: true,
    image: null,
    is_staff: false,
  },
];

/**
 * サンプル団体のシードデータ
 *
 * NOTE: slug に id をそのまま入れないこと。
 * slug は「所属していない人にも見える可能性がある値」として扱う必要がある一方、
 * id は所属している人にしか知られたくない値。
 * 同じにすると、片方が漏れたときにもう片方も分かってしまう。
 */
export const seedOrganizations: (typeof schema.organization.$inferInsert)[] = [
  {
    id: "grp_robotics",
    name: "ロボティクス開発プロジェクト",
    slug: "robotics-dev",
    createdAt: new Date(),
    updatedAt: new Date(),
    status: GroupStatus.Enabled,
  },
  {
    id: "grp_ai_hackers",
    name: "AI ハッカソンチーム",
    slug: "ai-hackers",
    createdAt: new Date(),
    updatedAt: new Date(),
    status: GroupStatus.Pending,
  },
  {
    id: "grp_disabled_group",
    name: "無効化された団体",
    slug: "disabled-group",
    createdAt: new Date(),
    updatedAt: new Date(),
    status: GroupStatus.Disabled,
  },
];

/**
 * 団体メンバーシップのシードデータ
 */
export const seedMembers: (typeof schema.member.$inferInsert)[] = [
  {
    id: "mem_taro_robotics",
    organizationId: "grp_robotics",
    userId: "usr_student_01",
    role: MembershipRole.Admin,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "mem_hanako_robotics",
    organizationId: "grp_robotics",
    userId: "usr_student_02",
    role: MembershipRole.Member,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "mem_taro_ai",
    organizationId: "grp_ai_hackers",
    userId: "usr_student_01",
    role: MembershipRole.Member,
    createdAt: new Date(),
    updatedAt: new Date(),
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
