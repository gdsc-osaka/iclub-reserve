import { ReservationStatus, MembershipRole } from "../../app/db/schema/reservation.js";

/**
 * 施設・備品のシードデータ
 */
export const seedFacilities = [
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
export const seedUsers = [
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
 */
export const seedGroups = [
  {
    id: "grp_robotics",
    name: "ロボティクス開発プロジェクト",
    isActive: true,
  },
  {
    id: "grp_ai_hackers",
    name: "AI ハッカソンチーム",
    isActive: true,
  },
];

/**
 * 団体メンバーシップのシードデータ
 */
export const seedMemberships = [
  {
    id: "mem_taro_robotics",
    name: "阪大 太郎",
    userId: "usr_student_01",
    groupId: "grp_robotics",
    role: MembershipRole.Owner,
  },
  {
    id: "mem_hanako_robotics",
    name: "阪大 花子",
    userId: "usr_student_02",
    groupId: "grp_robotics",
    role: MembershipRole.Member,
  },
  {
    id: "mem_taro_ai",
    name: "阪大 太郎",
    userId: "usr_student_01",
    groupId: "grp_ai_hackers",
    role: MembershipRole.Member,
  },
];

/**
 * サンプル予約のシードデータ
 * 現在日時から相対的な日時（明日、3日後など）を設定
 */
const now = Date.now();
const oneDayMs = 24 * 60 * 60 * 1000;

export const seedReservations = [
  {
    id: "res_sample_approved",
    groupId: "grp_robotics",
    facilityId: "fac_meeting_a",
    startAt: new Date(now + oneDayMs),
    endAt: new Date(now + oneDayMs + 2 * 60 * 60 * 1000),
    headCount: 4,
    note: "週次プロジェクト定例ミーティング",
    status: ReservationStatus.Approved,
    statusReason: "承認済み",
    createdBy: "usr_student_01",
  },
  {
    id: "res_sample_provisional",
    groupId: "grp_ai_hackers",
    facilityId: "fac_event_hall",
    startAt: new Date(now + 3 * oneDayMs),
    endAt: new Date(now + 3 * oneDayMs + 4 * 60 * 60 * 1000),
    headCount: 20,
    note: "AI勉強会＆ハッカソンキックオフ",
    status: ReservationStatus.Provisional,
    statusReason: null,
    createdBy: "usr_student_01",
  },
];
