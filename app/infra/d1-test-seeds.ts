/**
 * D1 のテストで使う前提データの組み立て関数。`testDb.seed(...)` に渡す。
 *
 * テストからだけ使う。アプリのコードから import しないこと。
 *
 * 引数は表の定義（`app/db/schema`）の insert の型そのままで、SQL は Drizzle の `toSQL()` で組み立てる。
 * 列名を手で書かないので、表に列を足してもここは直さずに済む。
 * NOT NULL で既定値の無い列を足したときは、組み立て関数を呼んでいるテストが型エラーになって気付ける。
 *
 * 省いた列には、多くのテストで使う値を入れる。作成日時・更新日時は 0（1970-01-01）にそろえる。
 * 表の既定値（今の時刻）に任せると、流すたびに値が変わってしまうため。
 *
 * ```ts
 * await testDb.seed(
 *   seedUser({ id: "usr_1", name: "阪大太郎", email: "taro@ecs.osaka-u.ac.jp" }),
 *   seedGroup({ id: "grp_1", name: "ロボット部" }),
 * );
 * ```
 */
import { drizzle } from "drizzle-orm/d1";

import * as schema from "~/db/schema";
import { auditLogActionTargetType } from "~/domain/audit-log";
import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import type { SeedStatement } from "./d1-test-db";

/**
 * SQL を組み立てるためだけに使う Drizzle。D1 にはつながない。
 * `toSQL()` は DB に問い合わせないので、つなぎ先が無くても動く。
 */
const builder = drizzle(null as unknown as D1Database, { schema });

const EPOCH = new Date(0);

/** 作成日時と更新日時の既定値 */
const timestamps = { createdAt: EPOCH, updatedAt: EPOCH };

/** insert の型のうち、組み立て関数が既定値を持つ列 K を省けるようにする */
type Seed<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

const toStatement = (query: { toSQL(): { sql: string; params: unknown[] } }): SeedStatement => {
  const { sql, params } = query.toSQL();
  return [sql, ...params];
};

/** 既定ではメールアドレスを確認済みの、一般の利用者（事務局ではない） */
export const seedUser = (row: Seed<typeof schema.user.$inferInsert, "emailVerified">) =>
  toStatement(builder.insert(schema.user).values({ emailVerified: true, ...timestamps, ...row }));

/** 既定では有効な団体 */
export const seedGroup = (
  row: Seed<typeof schema.groupTable.$inferInsert, "createdAt" | "updatedAt">,
) =>
  toStatement(
    builder
      .insert(schema.groupTable)
      .values({ status: GroupStatus.Enabled, ...timestamps, ...row }),
  );

/** 既定では有効で、カレンダー・写真・説明の無い施設 */
export const seedFacility = (row: typeof schema.facilityTable.$inferInsert) =>
  toStatement(builder.insert(schema.facilityTable).values({ ...timestamps, ...row }));

/** 既定では仮予約で、使用人数は 1 人 */
export const seedReservation = (
  row: Seed<typeof schema.reservationTable.$inferInsert, "headCount">,
) =>
  toStatement(
    builder.insert(schema.reservationTable).values({ headCount: 1, ...timestamps, ...row }),
  );

/** 既定ではメンバー（管理者ではない） */
export const seedMember = (
  row: Seed<typeof schema.groupMemberTable.$inferInsert, "createdAt" | "updatedAt">,
) => toStatement(builder.insert(schema.groupMemberTable).values({ ...timestamps, ...row }));

/**
 * 既定では事務局としてではない、変更の中身の無い操作。
 * 対象の種類は、操作の種類から決まる（`auditLogActionTargetType`）。
 */
export const seedAuditLog = (
  row: Seed<
    typeof schema.auditLogTable.$inferInsert,
    "occurredAt" | "actedAsStaff" | "targetType" | "changes"
  >,
) =>
  toStatement(
    builder.insert(schema.auditLogTable).values({
      occurredAt: EPOCH,
      actedAsStaff: false,
      targetType: auditLogActionTargetType[row.action],
      changes: {},
      ...row,
    }),
  );

/** 既定では承諾待ち */
export const seedStaffInvitation = (row: typeof schema.staffInvitationTable.$inferInsert) =>
  toStatement(builder.insert(schema.staffInvitationTable).values({ createdAt: EPOCH, ...row }));

/** 既定では承諾待ちの、メンバーとしての招待 */
export const seedGroupInvitation = (
  row: Seed<typeof schema.groupInvitationTable.$inferInsert, "role">,
) =>
  toStatement(
    builder
      .insert(schema.groupInvitationTable)
      .values({ role: MembershipRole.Member, createdAt: EPOCH, ...row }),
  );

export const seedReservationMessage = (row: typeof schema.reservationMessageTable.$inferInsert) =>
  toStatement(builder.insert(schema.reservationMessageTable).values(row));

export const seedReservationRead = (row: typeof schema.reservationReadTable.$inferInsert) =>
  toStatement(builder.insert(schema.reservationReadTable).values(row));

export const seedSession = (row: typeof schema.session.$inferInsert) =>
  toStatement(builder.insert(schema.session).values({ ...timestamps, ...row }));

/** 既定では、まだ 1 度も使っていないパスキー */
export const seedPasskey = (
  row: Seed<typeof schema.passkey.$inferInsert, "counter" | "deviceType" | "backedUp">,
) =>
  toStatement(
    builder.insert(schema.passkey).values({
      counter: 0,
      deviceType: "multiDevice",
      backedUp: false,
      createdAt: EPOCH,
      ...row,
    }),
  );
