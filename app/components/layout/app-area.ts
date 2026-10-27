import { BriefcaseBusiness, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AppArea, toAreaDashboardPath } from "~/lib/app-area";

import type { ShellUser } from "./shell-user";

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
    to: toAreaDashboardPath(AppArea.User),
    icon: UserRound,
  },
  [AppArea.Staff]: {
    area: AppArea.Staff,
    label: "事務局",
    to: toAreaDashboardPath(AppArea.Staff),
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
