import { BriefcaseBusiness, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { ShellUser } from "./shell-user";

/**
 * 画面の領域（利用者の画面・事務局の画面）。
 *
 * ADR-016 決定 1・2 に従い、外枠やナビゲーションの出し分けに使用する。
 * ログイン後の行き先を決める loader（`app/routes/start/`）からも使うので、
 * フックは使わず、引数だけで決まる関数にしている。
 */
export const AppArea = { User: "user", Staff: "staff" } as const;
export type AppArea = (typeof AppArea)[keyof typeof AppArea];

/** 領域のリンク情報 */
export interface AppAreaLink {
  readonly area: AppArea;
  readonly label: string;
  readonly to: string;
  readonly icon: LucideIcon;
}

/** 各領域の表示定義（ADR-016 決定 5） */
export const appAreaLinks: Readonly<Record<AppArea, AppAreaLink>> = {
  [AppArea.User]: {
    area: AppArea.User,
    label: "利用者",
    to: "/",
    icon: UserRound,
  },
  [AppArea.Staff]: {
    area: AppArea.Staff,
    label: "事務局",
    to: "/staff",
    icon: BriefcaseBusiness,
  },
};

/**
 * その人が行ける画面の一覧を返す（ADR-016 決定 5）。
 *
 * 事務局なら [利用者, 事務局]、そうでなければ [利用者]。
 */
export const toAvailableAreas = (user: Pick<ShellUser, "isStaff">): readonly AppAreaLink[] =>
  user.isStaff
    ? [appAreaLinks[AppArea.User], appAreaLinks[AppArea.Staff]]
    : [appAreaLinks[AppArea.User]];

const USER_AREA_PATHS: readonly string[] = ["/", "/reservations", "/groups", "/groups/new"];

/**
 * URL のパスから画面の領域を判定する（ADR-016 決定 2）。
 *
 * - `/staff` と `/staff/` で始まるパス → 事務局（`/staff-invitations/...` などは含まない）
 * - `/`・`/reservations`・`/groups`・`/groups/new` に完全一致 → 利用者
 * - それ以外 → null（どちらでもない）
 */
export const toAreaFromPathname = (pathname: string): AppArea | null => {
  if (pathname === "/staff" || pathname.startsWith("/staff/")) {
    return AppArea.Staff;
  }
  if (USER_AREA_PATHS.includes(pathname)) {
    return AppArea.User;
  }
  return null;
};

/**
 * 外枠に出す領域を解決する（ADR-016 決定 3）。
 *
 * 事務局でなければいつも利用者。事務局なら pathArea ?? lastArea ?? AppArea.Staff。
 */
export const resolveShellArea = ({
  isStaff,
  pathArea,
  lastArea,
}: {
  readonly isStaff: boolean;
  readonly pathArea: AppArea | null;
  readonly lastArea: AppArea | null;
}): AppArea => {
  if (!isStaff) return AppArea.User;
  return pathArea ?? lastArea ?? AppArea.Staff;
};

/**
 * クッキーなどの文字列から AppArea を安全に取り出す。
 *
 * "user" または "staff" 以外は null を返す。
 */
export const parseAppArea = (value: string | null): AppArea | null => {
  if (value === AppArea.User) return AppArea.User;
  if (value === AppArea.Staff) return AppArea.Staff;
  return null;
};
