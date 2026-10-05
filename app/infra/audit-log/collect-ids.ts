import type { AuditLogChanges } from "~/domain/audit-log";

/**
 * changes の指定された key の項目に出てくる ID（before と after の両方）を into に集める。
 *
 * user_id や facility_id などの名前を後からまとめて引くために使用する。
 */
export const collectIds = (changes: AuditLogChanges, key: string, into: Set<string>): void => {
  const change = changes[key];
  if (change === undefined) return;
  for (const value of [change.before, change.after]) {
    if (typeof value === "string" && value !== "") into.add(value);
  }
};
