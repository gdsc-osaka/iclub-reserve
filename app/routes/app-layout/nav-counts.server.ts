import type { Result } from "neverthrow";

import type { NavCounts } from "~/components/layout/nav-items";
import { GroupStatus } from "~/domain/group";
import type { Database } from "~/infra/db";
import type { SessionUser } from "~/lib/auth/auth-session.server";
import type { QueryError } from "~/query/error";
import { countGroupsByStatus } from "~/query/group/group-search";
import { findUserInvitations } from "~/query/group/user-invitations";
import { findGroupUnreadUpdates } from "~/query/reservation/group-unread-updates";
import { countStaffPendingReservations } from "~/query/reservation/staff-pending-reservations";
import { findStaffUnreadMessages } from "~/query/reservation/staff-unread-messages";
import { logQueryError } from "~/routes/_shared/query-error.server";

import { sumCounts } from "./nav-counts";

/**
 * 外枠のナビゲーションに添える件数を数える（#189）。
 *
 * 数えられなかった件数は、ログに残したうえで null にする。例外にはしない。
 * 件数のために外枠が開けなくなると、DB が不調なときにアプリ全体が使えなくなる。
 */
export const loadNavCounts = async (
  db: Database,
  user: SessionUser,
  now: Date,
): Promise<NavCounts> => {
  // どれも互いの結果を使わないので、並べて待つ
  const [groupUnread, invitations, staff] = await Promise.all([
    readOrNull("groupUnread", user, findGroupUnreadUpdates(db, { actorUserId: user.id, now })),
    readOrNull("invitations", user, findUserInvitations(db, { actorEmail: user.email, now })),
    /*
     * 事務局でない人には、事務局用の問い合わせを走らせない。
     * 走らせて門番（`ensureStaff`）に止めさせると、開くたびに Forbidden がログに残る。
     */
    user.is_staff ? loadStaffCounts(db, user, now) : null,
  ]);

  /*
   * 利用者の画面のダッシュボードの件数は、ダッシュボードに並ぶ確認が必要なこと
   * （団体側の未読と自分宛ての招待）の行の数にそろえる（ADR-016 決定 7）。
   * 未読は予約 1 件につき 1 行なので（COND-026 (1)）、予約の数で数える。
   * 1 つでも読めなければ出さない（少なく数えた値を出すと、確認が済んだと思わせてしまう）。
   */
  const dashboard = sumCounts([
    groupUnread?.allUnreadReservationIds.length ?? null,
    invitations?.length ?? null,
  ]);

  return {
    dashboard,
    "staff-dashboard": staff?.unreadMessages ?? null,
    "staff-approvals": staff?.pendingReservations ?? null,
    "staff-groups": staff?.pendingGroups ?? null,
  };
};

/** 事務局だけに数える件数。読めなかったものは null */
const loadStaffCounts = async (db: Database, user: SessionUser, now: Date) => {
  const [pendingReservations, groupsByStatus, unreadMessages] = await Promise.all([
    readOrNull("staffPending", user, countStaffPendingReservations(db, { isStaff: true, now })),
    readOrNull("staffGroups", user, countGroupsByStatus(db, { isStaff: true })),
    readOrNull(
      "staffUnread",
      user,
      findStaffUnreadMessages(db, { actorUserId: user.id, isStaff: true, now }),
    ),
  ]);

  return {
    pendingReservations,
    pendingGroups: groupsByStatus?.[GroupStatus.Pending] ?? null,
    // 行と同じく、未読のある予約の数を数える（COND-026 (1)）
    unreadMessages: unreadMessages?.allUnreadReservationIds.length ?? null,
  };
};

/** 読み取りの結果を返す。失敗ならログに残して null を返す */
const readOrNull = async <T>(
  what: string,
  user: SessionUser,
  read: PromiseLike<Result<T, QueryError>>,
): Promise<T | null> => {
  const result = await read;
  if (result.isErr()) {
    logQueryError({ where: `app-layout.loader.navCounts.${what}`, userId: user.id }, result.error);
    return null;
  }
  return result.value;
};
