import { groupTable } from "~/db/schema";
import type { Group } from "~/domain/group";

type GroupRow = typeof groupTable.$inferSelect;

export const toGroup = (row: GroupRow): Group => ({
  id: row.id,
  name: row.name,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
