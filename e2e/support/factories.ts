import { randomUUID } from "node:crypto";
import * as schema from "~/db/schema";
import { GroupStatus } from "~/domain/group";
import { InvitationStatus } from "~/domain/invitation";
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
type InvitationRow = typeof schema.groupInvitationTable.$inferSelect;
type ReservationRow = typeof schema.reservationTable.$inferSelect;
type SessionRow = typeof schema.session.$inferSelect;
type PasskeyRow = typeof schema.passkey.$inferSelect;

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

/** 団体への招待を作る。既定では、一般メンバーとしての承諾待ちで、1 週間後に期限が切れる */
export async function createInvitation(
  db: E2eDb,
  values: Pick<typeof schema.groupInvitationTable.$inferInsert, "groupId" | "email" | "inviterId"> &
    Partial<typeof schema.groupInvitationTable.$inferInsert>,
): Promise<InvitationRow> {
  const [row] = await db
    .insert(schema.groupInvitationTable)
    .values({
      id: `inv_e2e_${uniqueSuffix()}`,
      role: MembershipRole.Member,
      status: InvitationStatus.Pending,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      ...values,
    })
    .returning();
  return row;
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

/**
 * ブラウザの種類（User-Agent）の例。ログイン中の端末の一覧（UC-031）に出る名前は、ここから決まる（COND-020）。
 * テストを動かすブラウザ（パソコンの Chrome）とは違う名前になるものを選んでいる。
 */
export const UserAgents = {
  /** 一覧では「Android の Chrome」と出る */
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
  /** 一覧では「iPad の Safari」と出る */
  iPadSafari:
    "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
} as const;

/**
 * ほかの端末でのログインを作る。既定では、ログインしたばかりで 1 週間有効なログインになる。
 *
 * ブラウザには渡さないので、テストを動かしているブラウザからは使えない。
 * ログイン中の端末の一覧（UC-031）に、ほかの端末として並べるために使う。
 */
export async function createSession(
  db: E2eDb,
  values: Pick<typeof schema.session.$inferInsert, "userId"> &
    Partial<typeof schema.session.$inferInsert>,
): Promise<SessionRow> {
  const suffix = uniqueSuffix();
  const now = new Date();
  const [row] = await db
    .insert(schema.session)
    .values({
      id: `ses_e2e_${suffix}`,
      token: `tok_e2e_${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      ...values,
    })
    .returning();
  return row;
}

/**
 * 登録済みのパスキーを作る。
 *
 * DB に行があるだけで、鍵の中身は本物ではないので、このパスキーではログインできない。
 * 一覧・名前の変更・削除（UC-030）を確かめるために使う。
 * ログインまで確かめたいときは、仮想の認証器（`e2e/support/passkey.ts`）で画面から登録する。
 */
export async function createPasskey(
  db: E2eDb,
  values: Pick<typeof schema.passkey.$inferInsert, "userId"> &
    Partial<typeof schema.passkey.$inferInsert>,
): Promise<PasskeyRow> {
  const suffix = uniqueSuffix();
  const [row] = await db
    .insert(schema.passkey)
    .values({
      id: `pk_e2e_${suffix}`,
      name: `E2E のパスキー ${suffix}`,
      publicKey: "e2e-dummy-public-key",
      credentialID: `cred_e2e_${suffix}`,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: "internal",
      createdAt: new Date(),
      aaguid: null,
      ...values,
    })
    .returning();
  return row;
}
