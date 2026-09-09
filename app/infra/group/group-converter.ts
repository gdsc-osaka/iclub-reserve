import { organization } from "~/db/schema";
import type { Group } from "~/domain/group";

type Organization = typeof organization.$inferSelect;

export const toGroup = (organization: Organization): Group => ({
  id: organization.id,
  name: organization.name,
  status: organization.status,
  createdAt: organization.createdAt,
  updatedAt: organization.updatedAt,
});
