import { type AppArea, toSharedScreenPath } from "~/lib/app-area";

/**
 * 団体まわりの画面を行き来する URL を組み立てる。
 */

/**
 * 団体管理（SCR-007）の URL を組み立てる。
 */
export const toGroupDetailPath = (area: AppArea, groupId: string): string =>
  toSharedScreenPath(area, `/groups/${encodeURIComponent(groupId)}`);
