import { and, count, eq, sql } from "drizzle-orm";
import { ResultAsync } from "neverthrow";
import { user } from "~/db/schema";
import { type StaffError, StaffErrorCode, type StaffMemberRepository } from "~/domain/staff";
import type { Database } from "../db";

const databaseError =
  (operation: string) =>
  (cause: unknown): StaffError => ({
    code: StaffErrorCode.DatabaseError,
    message: `事務局メンバーの${operation}に失敗しました。`,
    cause,
  });

export const createStaffMemberRepository = (db: Database): StaffMemberRepository => {
  const findStaffByEmail = (
    normalizedEmail: string,
  ): ResultAsync<{ readonly id: string } | null, StaffError> =>
    ResultAsync.fromPromise(
      db
        .select({ id: user.id })
        .from(user)
        .where(and(sql`lower(${user.email}) = ${normalizedEmail}`, eq(user.is_staff, true)))
        .limit(1),
      databaseError("取得"),
    ).map((rows) => rows.at(0) ?? null);

  const findStaffById = (userId: string): ResultAsync<{ readonly id: string } | null, StaffError> =>
    ResultAsync.fromPromise(
      db
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, userId), eq(user.is_staff, true)))
        .limit(1),
      databaseError("取得"),
    ).map((rows) => rows.at(0) ?? null);

  const countStaff = (): ResultAsync<number, StaffError> =>
    ResultAsync.fromPromise(
      db.select({ total: count() }).from(user).where(eq(user.is_staff, true)),
      databaseError("件数取得"),
    ).map((rows) => rows.at(0)?.total ?? 0);

  const revoke = (userId: string, now: Date): ResultAsync<number, StaffError> =>
    ResultAsync.fromPromise(
      db
        .update(user)
        .set({ is_staff: false, updatedAt: now })
        .where(
          and(
            eq(user.id, userId),
            eq(user.is_staff, true),
            sql`(SELECT COUNT(*) FROM ${user} WHERE ${user.is_staff} = 1) >= 2`,
          ),
        )
        .returning({ id: user.id }),
      databaseError("剥奪"),
    ).map((rows) => rows.length);

  return { findStaffByEmail, findStaffById, countStaff, revoke };
};
