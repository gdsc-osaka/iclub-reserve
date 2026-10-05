import { and, eq, isNotNull, or } from "drizzle-orm";
import { err, ok, ResultAsync } from "neverthrow";
import { groupMemberTable, reservationMessageTable, reservationTable, user } from "~/db/schema";
import { MembershipRole } from "~/domain/membership";
import { QueryErrorCode, type QueryError } from "~/query/error";
import type {
  ReservationMailAudience,
  ReservationMailRecipient,
  ReservationMailRecipients,
  ReservationMailRecipientsQuery,
  ReservationMessageAudience,
} from "~/query/reservation/reservation-mail-recipients";
import type { Database } from "../db";
import { toMembershipRole } from "../membership/membership-converter";

/** 申請者を引く SELECT が返す行。2 つのメソッドで起点の表は違うが、取る列はそろえてある */
type ApplicantRow = { id: string; email: string; name: string };

/** 団体メンバーを引く SELECT が返す行。管理者かどうかはここでは絞らず、取り出してから判定する */
type GroupMemberRow = { userId: string; email: string; name: string; role: string };

/**
 * 申請者と団体管理者を、メールアドレスをキーにした 1 つのマップにまとめる。
 *
 * 申請者が管理者を兼ねていても 1 通にまとめるため、先に申請者を入れてから管理者を足す。
 * 2 つのメソッドで同じ規則を使うので、ここに 1 つだけ置く
 * （片方だけ直す事故を防ぐ）。
 */
const buildGroupRecipients = (
  applicantRows: readonly ApplicantRow[],
  memberRows: readonly GroupMemberRow[],
): Map<string, ReservationMailRecipient> => {
  const recipients = new Map<string, ReservationMailRecipient>();

  // 1. 申請者を追加（見つからない・宛先の条件を満たさない場合は、エラーにせず管理者のみで進める）
  const applicant = applicantRows.at(0);
  if (applicant?.email) {
    recipients.set(applicant.email, {
      userId: applicant.id,
      address: applicant.email,
      name: applicant.name,
    });
  }

  // 2. 団体の管理者メンバーを追加
  for (const row of memberRows) {
    if (!row.email) continue;
    if (toMembershipRole(row.role) !== MembershipRole.Admin) continue;
    if (recipients.has(row.email)) continue;

    recipients.set(row.email, {
      userId: row.userId,
      address: row.email,
      name: row.name,
    });
  }

  return recipients;
};

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
 * メールアドレスで重複を取り除き、アドレス昇順に並べた宛先リストを生成する純粋関数。
 */
const toUniqueSortedRecipients = (
  rows: readonly { id: string; email: string; name: string | null }[],
): ReservationMailRecipients => {
  const map = new Map<string, ReservationMailRecipient>();
  for (const row of rows) {
    if (!row.email) continue;
    if (!map.has(row.email)) {
      map.set(row.email, {
        userId: row.id,
        address: row.email,
        name: row.name,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.address.localeCompare(b.address));
};

/**
 * 既存の予約について、申請者を引く SELECT クエリ。
 *
 * 申請者は、いまも予約の全項目を見られる人（自団体のメンバーか事務局。COND-008 の (1)）に限る。
 * 団体から外された元メンバー（UC-011）や、他団体の予約を代わりに申請した後で
 * 事務局権限を剥奪された人（UC-028）に、通知を届けないため。
 * group_member は (group_id, user_id) が一意なので、左結合しても申請者の行は増えない。
 * findByReservationId と findForMessage で同じ条件を用いるため共通化する。
 */
const selectApplicantForReservation = (db: Database, reservationId: string) =>
  db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
    })
    .from(reservationTable)
    .innerJoin(user, eq(user.id, reservationTable.createdBy))
    .leftJoin(
      groupMemberTable,
      and(
        eq(groupMemberTable.groupId, reservationTable.groupId),
        eq(groupMemberTable.userId, reservationTable.createdBy),
      ),
    )
    .where(
      and(
        eq(reservationTable.id, reservationId),
        or(isNotNull(groupMemberTable.id), eq(user.is_staff, true)),
      ),
    );

/**
 * 既存の予約について、その団体のメンバーを引く SELECT クエリ。
 */
const selectGroupMembersForReservation = (db: Database, reservationId: string) =>
  db
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: groupMemberTable.role,
    })
    .from(reservationTable)
    .innerJoin(groupMemberTable, eq(groupMemberTable.groupId, reservationTable.groupId))
    .innerJoin(user, eq(user.id, groupMemberTable.userId))
    .where(eq(reservationTable.id, reservationId));

/**
 * その予約に団体側として（sent_as_staff = false）メッセージを送信したことのあるユーザーを引く SELECT クエリ。
 *
 * 申請者と同様に、いまも予約の全項目を見られる人（自団体のメンバーか事務局。COND-008 の (1)）に限る。
 */
const selectPriorGroupSideSenders = (db: Database, reservationId: string) =>
  db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
    })
    .from(reservationMessageTable)
    .innerJoin(reservationTable, eq(reservationTable.id, reservationMessageTable.reservationId))
    .innerJoin(user, eq(user.id, reservationMessageTable.senderId))
    .leftJoin(
      groupMemberTable,
      and(
        eq(groupMemberTable.groupId, reservationTable.groupId),
        eq(groupMemberTable.userId, reservationMessageTable.senderId),
      ),
    )
    .where(
      and(
        eq(reservationMessageTable.reservationId, reservationId),
        eq(reservationMessageTable.sentAsStaff, false),
        or(isNotNull(groupMemberTable.id), eq(user.is_staff, true)),
      ),
    );

/**
 * Cloudflare D1 (Drizzle) を使った ReservationMailRecipientsQuery の実装。
 *
 * D1 の往復コストを抑えるため、通知先の取得は `db.batch([...])` により 1 回のネットワーク往復で取得する。
 */
export const createReservationMailRecipientsQuery = (
  db: Database,
): ReservationMailRecipientsQuery => {
  /** 事務局（user.is_staff）。予約にも団体にも依存しないので、どのメソッドでも同じ 1 文 */
  const staffQuery = () =>
    db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
      })
      .from(user)
      .where(eq(user.is_staff, true));

  return {
    findByReservationId: (reservationId: string) => {
      const reservationCheckQuery = db
        .select({ id: reservationTable.id })
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationId));

      const applicantQuery = selectApplicantForReservation(db, reservationId);
      const groupMembersQuery = selectGroupMembersForReservation(db, reservationId);

      return ResultAsync.fromPromise(
        db.batch([reservationCheckQuery, applicantQuery, groupMembersQuery, staffQuery()]),
        (error): QueryError => ({
          code: QueryErrorCode.DatabaseError,
          message: "予約通知先アドレスの取得に失敗しました。",
          cause: error,
        }),
      ).andThen(([reservationRows, applicantRows, memberRows, staffRows]) => {
        if (reservationRows.length === 0) {
          return err<ReservationMailAudience, QueryError>({
            code: QueryErrorCode.NotFound,
            message: `ID が ${reservationId} の予約は見つかりませんでした。`,
          });
        }

        return ok<ReservationMailAudience, QueryError>(
          buildAudience(buildGroupRecipients(applicantRows, memberRows), staffRows),
        );
      });
    },

    findForNewReservation: (args) => {
      // 申請者は所属を確かめずに取得する（事務局による他団体予約作成 COND-009 に対応）。
      // findByReservationId と違って宛先の条件（COND-008 の (1)）を足していないのは、
      // 呼び出し元の仮予約の申請（UC-002）が、直前に申請者が自団体のメンバーか事務局であることを
      // 確かめているため。申請の時点では条件を必ず満たす。
      const applicantQuery = db
        .select({
          id: user.id,
          email: user.email,
          name: user.name,
        })
        .from(user)
        .where(eq(user.id, args.applicantUserId));

      const groupMembersQuery = db
        .select({
          userId: user.id,
          email: user.email,
          name: user.name,
          role: groupMemberTable.role,
        })
        .from(groupMemberTable)
        .innerJoin(user, eq(user.id, groupMemberTable.userId))
        .where(eq(groupMemberTable.groupId, args.groupId));

      return ResultAsync.fromPromise(
        db.batch([applicantQuery, groupMembersQuery, staffQuery()]),
        (error): QueryError => ({
          code: QueryErrorCode.DatabaseError,
          message: "予約通知先アドレスの取得に失敗しました。",
          cause: error,
        }),
      ).map(([applicantRows, memberRows, staffRows]) =>
        buildAudience(buildGroupRecipients(applicantRows, memberRows), staffRows),
      );
    },

    findForMessage: (reservationId: string) => {
      const reservationCheckQuery = db
        .select({ id: reservationTable.id })
        .from(reservationTable)
        .where(eq(reservationTable.id, reservationId));

      const applicantQuery = selectApplicantForReservation(db, reservationId);
      const groupMembersQuery = selectGroupMembersForReservation(db, reservationId);
      const priorSendersQuery = selectPriorGroupSideSenders(db, reservationId);

      return ResultAsync.fromPromise(
        db.batch([
          reservationCheckQuery,
          applicantQuery,
          groupMembersQuery,
          staffQuery(),
          priorSendersQuery,
        ]),
        (error): QueryError => ({
          code: QueryErrorCode.DatabaseError,
          message: "予約メッセージ通知先アドレスの取得に失敗しました。",
          cause: error,
        }),
      ).andThen(([reservationRows, applicantRows, memberRows, staffRows, priorSenderRows]) => {
        if (reservationRows.length === 0) {
          return err<ReservationMessageAudience, QueryError>({
            code: QueryErrorCode.NotFound,
            message: `ID が ${reservationId} の予約は見つかりませんでした。`,
          });
        }

        const groupRecipientsMap = buildGroupRecipients(applicantRows, memberRows);
        const groupMembers = Array.from(groupRecipientsMap.values()).sort((a, b) =>
          a.address.localeCompare(b.address),
        );

        return ok<ReservationMessageAudience, QueryError>({
          staff: toUniqueSortedRecipients(staffRows),
          groupMembers,
          priorGroupSideSenders: toUniqueSortedRecipients(priorSenderRows),
        });
      });
    },
  };
};
