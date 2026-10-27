import type { RouterContextProvider } from "react-router";

import { AppArea } from "~/lib/app-area";
import { requireRequestUser, type SessionUser } from "~/lib/auth/auth-session.server";
import { ensureStaff } from "~/query/_shared/staff";
import { queryErrorResponse } from "./query-error.server";

/**
 * 開いている画面での、操作する人を決める（COND-030 の (1)・ADR-016 決定 11・12）。
 *
 * 事務局の画面は、事務局でなければ 403 にする（loader でも action でも、何かを読む前に呼ぶ）。
 * `actsAsStaff` は、ユースケースの `isStaff` にそのまま渡す。両方に置く画面のルートは、
 * セッションの `is_staff` をユースケースに直接渡さないこと（利用者の画面で事務局の権限が使われる）。
 */
export const requireAreaUser = async (
  context: Readonly<RouterContextProvider>,
  area: AppArea,
  where: string,
): Promise<{ readonly user: SessionUser; readonly actsAsStaff: boolean }> => {
  const user = requireRequestUser(context);

  if (area === AppArea.Staff) {
    const staffCheck = await ensureStaff(
      user.is_staff,
      "事務局ではない人が、事務局の画面を開こうとした。",
    );
    if (staffCheck.isErr()) {
      throw queryErrorResponse({ where, userId: user.id }, staffCheck.error);
    }
    return { user, actsAsStaff: true };
  }

  return { user, actsAsStaff: false };
};

/** ログの where の頭。両方に置く画面の loader・action は 2 つのルートで共有するので、事務局の画面には `staff-` を付けて分ける */
const areaWherePrefix: Readonly<Record<AppArea, string>> = {
  [AppArea.User]: "",
  [AppArea.Staff]: "staff-",
};
export const toAreaWhere = (area: AppArea, where: string): string =>
  `${areaWherePrefix[area]}${where}`;
