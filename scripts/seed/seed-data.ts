import { ReservationStatus } from "~/domain/reservation";
import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import * as schema from "~/db/schema";

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
 * 現在日時から相対的な日時（明日、3日後など）を設定
 *
 * トップページは「これから」と「履歴」に分けて表示するため、
 * 終わった予約と却下された予約も入れて、両方の並びを確かめられるようにしている。
 */
const now = Date.now();
const oneDayMs = 24 * 60 * 60 * 1000;

export const seedReservations: (typeof schema.reservationTable.$inferInsert)[] = [
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
    id: "res_sample_finished",
    groupId: "grp_robotics",
    facilityId: "fac_meeting_b",
    startAt: new Date(now - 7 * oneDayMs),
    endAt: new Date(now - 7 * oneDayMs + 2 * 60 * 60 * 1000),
    headCount: 6,
    note: "新歓ミーティング",
    status: ReservationStatus.Approved,
    statusReason: null,
    createdBy: "usr_student_02",
  },
  {
    id: "res_sample_rejected",
    groupId: "grp_robotics",
    facilityId: "fac_event_hall",
    startAt: new Date(now + 5 * oneDayMs),
    endAt: new Date(now + 5 * oneDayMs + 6 * 60 * 60 * 1000),
    headCount: 40,
    note: "作品展示会のリハーサル",
    status: ReservationStatus.Rejected,
    statusReason: "同じ時間帯に事務局主催のイベントが入っているため",
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
