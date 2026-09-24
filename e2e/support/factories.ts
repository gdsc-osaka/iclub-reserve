import { randomUUID } from "node:crypto";
import * as schema from "~/db/schema";
import { GroupStatus } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";
import { ReservationStatus } from "~/domain/reservation";
import type { E2eDb } from "./db.js";

/**
 * テストの前提となるデータを、DB に直接作る。
 *
 * 前提を画面から作ると遅いうえ、確かめたい操作とは関係のない画面の変更でテストが落ちる。
 * そこで「前提は DB に入れる・確かめたい操作は画面で行う・結果は画面で見る」と分けている。
 *
 * 名前・ID・メールアドレスには、呼ぶたびに違う印（`uniqueSuffix`）を付ける。
 * テストどうしが同じデータを取り合わないので、テストの順番に左右されない。
 * 値を変えたいときは、`overrides` で必要な項目だけを渡す。
 * 状態や役割は、文字列を書き写さずに `~/domain` の定数を使うこと。
 */

type UserRow = typeof schema.user.$inferSelect;
type FacilityRow = typeof schema.facilityTable.$inferSelect;
type GroupRow = typeof schema.groupTable.$inferSelect;
type ReservationRow = typeof schema.reservationTable.$inferSelect;

/** 呼ぶたびに違う、短い印 */
export const uniqueSuffix = (): string => randomUUID().slice(0, 8);

/** 利用者を作る。氏名が入っているので、初回設定（SCR-014）を通らずに画面を開ける */
export async function createUser(
  db: E2eDb,
  overrides: Partial<typeof schema.user.$inferInsert> = {},
): Promise<UserRow> {
  const suffix = uniqueSuffix();
  const [row] = await db
    .insert(schema.user)
    .values({
      id: `usr_e2e_${suffix}`,
      name: `E2E 利用者 ${suffix}`,
      email: `e2e-${suffix}@ecs.osaka-u.ac.jp`,
      emailVerified: true,
      is_staff: false,
      ...overrides,
    })
    .returning();
  return row;
}

/** 施設・設備を作る。予約が重ならないよう、予約を作るテストでは施設もテストごとに作る */
export async function createFacility(
  db: E2eDb,
  overrides: Partial<typeof schema.facilityTable.$inferInsert> = {},
): Promise<FacilityRow> {
  const suffix = uniqueSuffix();
  const [row] = await db
    .insert(schema.facilityTable)
    .values({
      id: `fac_e2e_${suffix}`,
      name: `E2E 会議室 ${suffix}`,
      description: "E2E テスト用の施設",
      isActive: true,
      ...overrides,
    })
    .returning();
  return row;
}

/** 団体に入れる人と、その役割 */
export interface GroupMemberInput {
  readonly userId: string;
  readonly role: MembershipRole;
}

/** 団体を作り、指定した人を所属させる。既定では有効な団体になる */
export async function createGroup(
  db: E2eDb,
  {
    members,
    ...overrides
  }: Partial<typeof schema.groupTable.$inferInsert> & { members: readonly GroupMemberInput[] },
): Promise<GroupRow> {
  const suffix = uniqueSuffix();
  const now = new Date();
  const [group] = await db
    .insert(schema.groupTable)
    .values({
      id: `grp_e2e_${suffix}`,
      name: `E2E 団体 ${suffix}`,
      status: GroupStatus.Enabled,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning();

  if (members.length > 0) {
    await db.insert(schema.groupMemberTable).values(
      members.map((member) => ({
        id: `mem_e2e_${uniqueSuffix()}`,
        groupId: group.id,
        userId: member.userId,
        role: member.role,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  return group;
}

/** 予約を作る。既定では仮予約になる */
export async function createReservation(
  db: E2eDb,
  values: Pick<
    typeof schema.reservationTable.$inferInsert,
    "groupId" | "facilityId" | "createdBy" | "startAt" | "endAt"
  > &
    Partial<typeof schema.reservationTable.$inferInsert>,
): Promise<ReservationRow> {
  const [row] = await db
    .insert(schema.reservationTable)
    .values({
      id: `res_e2e_${uniqueSuffix()}`,
      headCount: 4,
      note: null,
      status: ReservationStatus.Provisional,
      statusReason: null,
      ...values,
    })
    .returning();
  return row;
}
