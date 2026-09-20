import { eq } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";
import { member, reservationTable, user } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  ReservationMailAudience,
  ReservationMailRecipient,
  ReservationMailRecipientsQuery,
} from "~/query/reservation/reservation-mail-recipients";
import type { Database } from "../db";
import { toMembershipRoles } from "../membership/membership-converter";

/**
 * 団体メンバーと事務局の生データから、重複を除去・昇順ソートした ReservationMailAudience を組み立てる。
 *
 * 事務局リストから団体メンバー（申請者・団体管理者）と重複するメールアドレスを取り除くことで、
 * 兼務しているユーザーへの同一通知の重複送信や idempotencyKey 衝突を防ぐ。
 */
const buildAudience = (
  groupRecipientsMap: Map<string, ReservationMailRecipient>,
  staffRows: readonly { id: string; email: string; name: string | null }[],
): ReservationMailAudience => {
  const groupMembers = Array.from(groupRecipientsMap.values()).sort((a, b) =>
    a.address.localeCompare(b.address),
  );

  const staffMap = new Map<string, ReservationMailRecipient>();
  for (const staff of staffRows) {
    if (!staff.email) continue;
    // 団体側に含まれるアドレスは除外する（重複送信防止）
    if (!groupRecipientsMap.has(staff.email) && !staffMap.has(staff.email)) {
      staffMap.set(staff.email, {
        userId: staff.id,
        address: staff.email,
        name: staff.name,
      });
    }
  }

  const sortedStaff = Array.from(staffMap.values()).sort((a, b) =>
    a.address.localeCompare(b.address),
  );

  return { groupMembers, staff: sortedStaff };
};

/**
 * Cloudflare D1 (Drizzle) を使った ReservationMailRecipientsQuery の実装。
 *
 * D1 の往復コストを抑えるため、通知先の取得は `db.batch([...])` により 1 回のネットワーク往復で取得する。
 */
export const createReservationMailRecipientsQuery = (
  db: Database,
): ReservationMailRecipientsQuery => ({
  findByReservationId: (reservationId: string) => {
    const reservationCheckQuery = db
      .select({ id: reservationTable.id })
      .from(reservationTable)
      .where(eq(reservationTable.id, reservationId));

    const applicantQuery = db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
      })
      .from(reservationTable)
      .innerJoin(user, eq(user.id, reservationTable.createdBy))
      .where(eq(reservationTable.id, reservationId));

    const groupAdminsQuery = db
      .select({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: member.role,
      })
      .from(reservationTable)
      .innerJoin(member, eq(member.organizationId, reservationTable.groupId))
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(reservationTable.id, reservationId));

    const staffQuery = db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
      })
      .from(user)
      .where(eq(user.is_staff, true));

    return ResultAsync.fromPromise(
      db.batch([reservationCheckQuery, applicantQuery, groupAdminsQuery, staffQuery]),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "予約通知先アドレスの取得に失敗しました。",
        cause: error,
      }),
    ).andThen(([reservationRows, applicantRows, adminRows, staffRows]) => {
      if (reservationRows.length === 0) {
        return err<ReservationMailAudience, QueryError>({
          code: QueryErrorCode.NotFound,
          message: `ID が ${reservationId} の予約は見つかりませんでした。`,
        });
      }

      const recipientsMap = new Map<string, ReservationMailRecipient>();

      // 1. 申請者を追加（createdBy が null の場合やユーザーが見つからない場合は applicantRows が空になる）
      const applicant = applicantRows[0];
      if (applicant?.email) {
        recipientsMap.set(applicant.email, {
          userId: applicant.id,
          address: applicant.email,
          name: applicant.name,
        });
      }

      // 2. 団体の管理者メンバーを追加
      for (const row of adminRows) {
        if (!row.email || !row.role) continue;

        const roles = toMembershipRoles(row.role);
        if (roles.includes(MembershipRole.Admin)) {
          if (!recipientsMap.has(row.email)) {
            recipientsMap.set(row.email, {
              userId: row.userId ?? undefined,
              address: row.email,
              name: row.name,
            });
          }
        }
      }

      return ok<ReservationMailAudience, QueryError>(buildAudience(recipientsMap, staffRows));
    });
  },

  findForNewReservation: (args) => {
    // 申請者は所属に関わらず取得する（事務局による他団体予約作成 COND-009 に対応）
    const applicantQuery = db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
      })
      .from(user)
      .where(eq(user.id, args.applicantUserId));

    const groupAdminsQuery = db
      .select({
        userId: user.id,
        email: user.email,
        name: user.name,
        role: member.role,
      })
      .from(member)
      .leftJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, args.groupId));

    const staffQuery = db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
      })
      .from(user)
      .where(eq(user.is_staff, true));

    return ResultAsync.fromPromise(
      db.batch([applicantQuery, groupAdminsQuery, staffQuery]),
      (error): QueryError => ({
        code: QueryErrorCode.DatabaseError,
        message: "予約通知先アドレスの取得に失敗しました。",
        cause: error,
      }),
    ).map(([applicantRows, adminRows, staffRows]) => {
      const recipientsMap = new Map<string, ReservationMailRecipient>();

      // 1. 申請者を追加（見つからない場合でもエラーにせず管理者のみで進める）
      const applicant = applicantRows[0];
      if (applicant?.email) {
        recipientsMap.set(applicant.email, {
          userId: applicant.id,
          address: applicant.email,
          name: applicant.name,
        });
      }

      // 2. 団体の管理者メンバーを追加
      for (const row of adminRows) {
        if (!row.email || !row.role) continue;

        const roles = toMembershipRoles(row.role);
        if (roles.includes(MembershipRole.Admin)) {
          if (!recipientsMap.has(row.email)) {
            recipientsMap.set(row.email, {
              userId: row.userId ?? undefined,
              address: row.email,
              name: row.name,
            });
          }
        }
      }

      return buildAudience(recipientsMap, staffRows);
    });
  },
});
