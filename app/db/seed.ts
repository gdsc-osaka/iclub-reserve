/**
 * DB に開発用の初期データ（シード）を流し込む処理。
 *
 * 空の DB では画面を確認できないため、ユーザー・団体・施設・予約が一通り揃った
 * 「それらしい」データを用意する。手で 1 件ずつ作る手間を省くのが目的。
 *
 * ## 方針
 *
 * - **ID は `seed_` で始まる固定値**にしている。毎回同じ URL で同じ画面を開けるうえ、
 *   「シードで入れた行かどうか」を ID だけで見分けられる。
 * - 何度実行しても同じ状態になるよう、**先に `seed_` の行を消してから入れ直す**。
 *   手で追加したデータ（`seed_` 以外の ID）には触らない。
 * - Better Auth が管理する `user` テーブルにも行を入れる。認証コード（OTP）で
 *   ログインできるように、許可ドメイン（@osaka-u.ac.jp）のメールアドレスにしてある。
 *
 * ## drizzle-seed を使っていない理由
 *
 * drizzle-seed は SQLite に対応しており、型の上では D1 にもそのまま渡せる
 * （`DrizzleD1Database` は `BaseSQLiteDatabase` の一種）。ただし実際には次の問題がある。
 *
 * 1. **D1 のプレースホルダ上限（1 クエリあたり 100 個）を超える。**
 *    drizzle-seed は「32766 ÷ 列数」行をまとめて INSERT するため、
 *    1 テーブルに 10 行あまり入れた時点で上限に当たる。
 * 2. **`reset()` が D1 では正しく動かない。** `PRAGMA foreign_keys = OFF` を
 *    単独で実行しているが、D1 の PRAGMA はトランザクション内でしか効かないため、
 *    外部キーの張られたテーブルの削除に失敗する。
 * 3. **生成されるのがランダムなデータ**で、`status` の値や「開始 < 終了」といった
 *    このアプリの決まりごとを満たさない。結局ほぼ全列を `refine()` で書くことになり、
 *    手で書くのと変わらない。
 *
 * 大量のデータで表示や性能を試したいときだけ、別途 drizzle-seed を検討すればよい。
 */

import { getTableColumns, like } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import {
  facilityTable,
  groupTable,
  membershipTable,
  MembershipRole,
  reservationTable,
  ReservationStatus,
  user as userTable,
} from "~/db/schema";
import type { Database } from "~/infra/db";

/** シードで入れる行の ID につける接頭辞。 */
const SEED_ID_PREFIX = "seed_";

/** `like` に渡す、シードで入れた行だけに当たるパターン。 */
const SEED_ID_PATTERN = `${SEED_ID_PREFIX}%`;

/**
 * D1 が 1 つのクエリに受け付けるプレースホルダ（`?`）の上限。
 *
 * まとめて INSERT すると「行数 × 列数」個のプレースホルダを使うため、
 * 行数が多いとこの上限に当たる。ローカルの D1 は素の SQLite なので気づけないが、
 * Cloudflare 上の D1 では失敗する。
 *
 * @see https://developers.cloudflare.com/d1/platform/limits/
 */
const D1_MAX_BOUND_PARAMETERS = 100;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** 日本時間（UTC+9）と UTC の差。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * `now` から `days` 日後の、**日本時間で** `hour` 時ちょうどを表す Date を作る。
 *
 * 画面の日時表示は日本時間に固定されている（`app/lib/date.ts`）ため、
 * 「明日の 13 時」のようなきりのよい時刻で入れておくと、予約一覧が読みやすくなる。
 */
const jstHour = (now: Date, days: number, hour: number): Date => {
  // 日本時間での暦日を求めるため、9 時間ずらしてから UTC の年月日を読む
  const jst = new Date(now.getTime() + days * DAY_IN_MS + JST_OFFSET_MS);

  return new Date(
    Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), hour) - JST_OFFSET_MS,
  );
};

/**
 * 行の配列を、D1 のプレースホルダ上限に収まる大きさに分割する。
 *
 * 列数はテーブルの定義から数える。値を省いた列にもプレースホルダが使われることが
 * あるため、「行が持つキーの数」ではなく「テーブルの列数」で見積もるほうが安全。
 *
 * テストから使えるように export している。
 */
export const chunkRowsForD1 = <TRow>(rows: readonly TRow[], columnCount: number): TRow[][] => {
  // 1 行だけで上限を超えるテーブルはこのアプリには無いが、0 除算と 0 件分割は避ける
  const rowsPerChunk = Math.max(1, Math.floor(D1_MAX_BOUND_PARAMETERS / columnCount));
  const chunks: TRow[][] = [];

  for (let i = 0; i < rows.length; i += rowsPerChunk) {
    chunks.push(rows.slice(i, i + rowsPerChunk));
  }

  return chunks;
};

/** 1 つのテーブルに、上限を超えないよう小分けにして INSERT する。 */
const insertAll = async <TTable extends SQLiteTable>(
  db: Database,
  table: TTable,
  rows: readonly TTable["$inferInsert"][],
): Promise<number> => {
  const columnCount = Object.keys(getTableColumns(table)).length;

  for (const chunk of chunkRowsForD1(rows, columnCount)) {
    await db.insert(table).values(chunk);
  }

  return rows.length;
};

/** シードで入れるユーザー。事務局 1 名と、団体側 2 名。 */
const seedUsers = [
  {
    id: "seed_user_staff",
    name: "事務局 太郎",
    email: "seed-staff@osaka-u.ac.jp",
    emailVerified: true,
    is_staff: true,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
  },
  {
    id: "seed_user_ichiro",
    name: "阪大 一郎",
    email: "seed-ichiro@ecs.osaka-u.ac.jp",
    emailVerified: true,
    is_staff: false,
    createdAt: new Date("2026-04-02T00:00:00.000Z"),
    updatedAt: new Date("2026-04-02T00:00:00.000Z"),
  },
  {
    id: "seed_user_hanako",
    name: "阪大 花子",
    email: "seed-hanako@ecs.osaka-u.ac.jp",
    emailVerified: true,
    is_staff: false,
    createdAt: new Date("2026-04-03T00:00:00.000Z"),
    updatedAt: new Date("2026-04-03T00:00:00.000Z"),
  },
] as const satisfies readonly (typeof userTable.$inferInsert)[];

/** シードで入れる団体。停止中の団体も 1 つ入れて、状態の出し分けを確認できるようにする。 */
const seedGroups = [
  {
    id: "seed_group_robot",
    name: "ロボット研究会",
    isActive: true,
    createdAt: new Date("2026-04-05T00:00:00.000Z"),
    updatedAt: new Date("2026-04-05T00:00:00.000Z"),
  },
  {
    id: "seed_group_music",
    name: "軽音楽部",
    isActive: true,
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z"),
  },
  {
    id: "seed_group_history",
    name: "歴史研究会",
    isActive: false,
    createdAt: new Date("2026-04-07T00:00:00.000Z"),
    updatedAt: new Date("2026-04-07T00:00:00.000Z"),
  },
] as const satisfies readonly (typeof groupTable.$inferInsert)[];

/**
 * シードで入れる所属。
 *
 * 一郎はロボット研究会の代表で、軽音楽部にも所属している。花子はロボット研究会の一般会員。
 * 「所属していない団体は見られない」という認可（`getGroupUseCase`）を試せるように、
 * 歴史研究会には誰も所属させていない。
 */
const seedMemberships = [
  {
    id: "seed_membership_ichiro_robot",
    name: "阪大 一郎",
    userId: "seed_user_ichiro",
    groupId: "seed_group_robot",
    role: MembershipRole.Owner,
    createdAt: new Date("2026-04-05T00:00:00.000Z"),
    updatedAt: new Date("2026-04-05T00:00:00.000Z"),
  },
  {
    id: "seed_membership_ichiro_music",
    name: "阪大 一郎",
    userId: "seed_user_ichiro",
    groupId: "seed_group_music",
    role: MembershipRole.Member,
    createdAt: new Date("2026-04-06T00:00:00.000Z"),
    updatedAt: new Date("2026-04-06T00:00:00.000Z"),
  },
  {
    id: "seed_membership_hanako_robot",
    name: "阪大 花子",
    userId: "seed_user_hanako",
    groupId: "seed_group_robot",
    role: MembershipRole.Member,
    createdAt: new Date("2026-04-07T00:00:00.000Z"),
    updatedAt: new Date("2026-04-07T00:00:00.000Z"),
  },
] as const satisfies readonly (typeof membershipTable.$inferInsert)[];

/** シードで入れる施設。改修中で使えない施設も 1 つ入れておく。 */
const seedFacilities = [
  {
    id: "seed_facility_hall",
    name: "イノベーションホール",
    description: "最大 100 名まで利用できる多目的ホール。プロジェクターと音響設備あり。",
    isActive: true,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
  },
  {
    id: "seed_facility_studio",
    name: "スタジオ A",
    description: "防音設備のある練習室。ドラムセットとアンプを備え付けてある。",
    isActive: true,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
  },
  {
    id: "seed_facility_meeting",
    name: "ミーティングルーム B",
    description: "8 名程度で使える会議室。現在は改修工事のため利用できない。",
    isActive: false,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
  },
] as const satisfies readonly (typeof facilityTable.$inferInsert)[];

/**
 * シードで入れる予約を組み立てる。
 *
 * 予約は「今」からの相対で作る。日付を固定にすると、しばらく経ってから
 * シードし直したときに、すべて過去の予約になってしまうため。
 * 申請中・承認済み・却下・取消と、状態を一通り揃えてある。
 */
const buildSeedReservations = (now: Date) =>
  [
    {
      id: "seed_reservation_approved_hall",
      groupId: "seed_group_robot",
      facilityId: "seed_facility_hall",
      startAt: jstHour(now, 1, 13),
      endAt: jstHour(now, 1, 15),
      headCount: 20,
      note: "新入生向けのロボット製作体験会",
      status: ReservationStatus.Approved,
      createdBy: "seed_user_ichiro",
      createdAt: new Date(now.getTime() - 3 * DAY_IN_MS),
      updatedAt: new Date(now.getTime() - 2 * DAY_IN_MS),
    },
    {
      id: "seed_reservation_provisional_studio",
      groupId: "seed_group_music",
      facilityId: "seed_facility_studio",
      startAt: jstHour(now, 3, 18),
      endAt: jstHour(now, 3, 21),
      headCount: 6,
      note: "学園祭に向けた練習",
      status: ReservationStatus.Provisional,
      createdBy: "seed_user_ichiro",
      createdAt: new Date(now.getTime() - DAY_IN_MS),
      updatedAt: new Date(now.getTime() - DAY_IN_MS),
    },
    {
      id: "seed_reservation_rejected_hall",
      groupId: "seed_group_music",
      facilityId: "seed_facility_hall",
      startAt: jstHour(now, 5, 10),
      endAt: jstHour(now, 5, 12),
      headCount: 80,
      note: "定期演奏会のリハーサル",
      status: ReservationStatus.Rejected,
      statusReason: "同じ時間帯に大学行事が入っているため。",
      createdBy: "seed_user_hanako",
      createdAt: new Date(now.getTime() - 4 * DAY_IN_MS),
      updatedAt: new Date(now.getTime() - 3 * DAY_IN_MS),
    },
    {
      id: "seed_reservation_cancelled_studio",
      groupId: "seed_group_robot",
      facilityId: "seed_facility_studio",
      startAt: jstHour(now, 2, 9),
      endAt: jstHour(now, 2, 11),
      headCount: 4,
      note: "次回大会に向けた打ち合わせ",
      status: ReservationStatus.Cancelled,
      statusReason: "参加者の都合がつかなくなったため。",
      createdBy: "seed_user_hanako",
      createdAt: new Date(now.getTime() - 6 * DAY_IN_MS),
      updatedAt: new Date(now.getTime() - 5 * DAY_IN_MS),
    },
    {
      id: "seed_reservation_past_hall",
      groupId: "seed_group_robot",
      facilityId: "seed_facility_hall",
      startAt: jstHour(now, -14, 13),
      endAt: jstHour(now, -14, 17),
      headCount: 35,
      note: "ロボットコンテストの学内予選",
      status: ReservationStatus.Approved,
      createdBy: "seed_user_ichiro",
      createdAt: new Date(now.getTime() - 30 * DAY_IN_MS),
      updatedAt: new Date(now.getTime() - 28 * DAY_IN_MS),
    },
  ] as const satisfies readonly (typeof reservationTable.$inferInsert)[];

/** シードで入れた行の件数。実行結果の確認に使う。 */
export interface SeedSummary {
  readonly users: number;
  readonly groups: number;
  readonly memberships: number;
  readonly facilities: number;
  readonly reservations: number;
}

/**
 * `seed_` で始まる ID の行をすべて削除する。
 *
 * 外部キーに引っかからないよう、参照している側（予約・所属）から先に消す。
 * `user` を消すと、セッションやパスキーは ON DELETE CASCADE で一緒に消える。
 */
const deleteSeededRows = async (db: Database): Promise<void> => {
  await db.delete(reservationTable).where(like(reservationTable.id, SEED_ID_PATTERN));
  await db.delete(membershipTable).where(like(membershipTable.id, SEED_ID_PATTERN));
  await db.delete(groupTable).where(like(groupTable.id, SEED_ID_PATTERN));
  await db.delete(facilityTable).where(like(facilityTable.id, SEED_ID_PATTERN));
  await db.delete(userTable).where(like(userTable.id, SEED_ID_PATTERN));
};

/**
 * 開発用の初期データを DB に流し込む。
 *
 * 何度実行してもよい（実行のたびに `seed_` の行を消して入れ直す）。
 * 途中で失敗したときは例外がそのまま投げられる。開発用の道具なので、
 * `neverthrow` で包まずに、その場で気づける形にしてある。
 *
 * @param db 対象の DB。D1 であればローカルでもプレビューでも動く。
 * @param now 予約の日時を決める基準の時刻。テストから固定するために差し替えられる。
 */
export const seedDatabase = async (db: Database, now: Date = new Date()): Promise<SeedSummary> => {
  await deleteSeededRows(db);

  // 参照される側（ユーザー・団体・施設）から先に入れる
  const users = await insertAll(db, userTable, seedUsers);
  const groups = await insertAll(db, groupTable, seedGroups);
  const facilities = await insertAll(db, facilityTable, seedFacilities);
  const memberships = await insertAll(db, membershipTable, seedMemberships);
  const reservations = await insertAll(db, reservationTable, buildSeedReservations(now));

  return { users, groups, memberships, facilities, reservations };
};

/** シードの元データ。テストや、開発中に ID を参照したいときに使う。 */
export const seedData = {
  idPrefix: SEED_ID_PREFIX,
  users: seedUsers,
  groups: seedGroups,
  memberships: seedMemberships,
  facilities: seedFacilities,
  buildReservations: buildSeedReservations,
} as const;
