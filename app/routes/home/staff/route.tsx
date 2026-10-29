import { env } from "cloudflare:workers";

import { AppArea } from "~/lib/app-area";
import { GroupStatus, STAFF_PENDING_GROUPS_LIMIT } from "~/domain/group";
import { isStaffTransition, parseReservationTransition } from "~/domain/reservation/transition";
import { createDb, type Database } from "~/infra/db";
import type { SessionUser } from "~/lib/auth/auth-session.server";
import { requireAreaUser } from "~/routes/_shared/app-area.server";
import { findGroupSearchList } from "~/query/group/group-search";
import { findStaffPendingReservations } from "~/query/reservation/staff-pending-reservations";
import { findStaffTodaySchedule } from "~/query/reservation/staff-today-schedule";
import { findStaffUnlockRequiredReservations } from "~/query/reservation/staff-unlock-required-reservations";
import { findStaffUnreadMessages } from "~/query/reservation/staff-unread-messages";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { changeReservationStatus } from "~/routes/_shared/reservation-transition.server";

import type { Route } from "./+types/route";
import { DashboardHeader } from "../dashboard-header";
import { HomeIntent } from "../home-intent";
import { loadSection } from "../load-section.server";
import { markReservationRead } from "../mark-read.server";
import { readFormText } from "../read-form-text";
import { StaffPendingGroupsSection } from "./staff-pending-groups-section";
import { StaffPendingSection } from "./staff-pending-section";
import { StaffTilesSection } from "./staff-tiles-section";
import { StaffTodayScheduleSection } from "./staff-today-schedule-section";
import { StaffUnlockRequiredSection } from "./staff-unlock-required-section";
import { StaffUnreadMessagesSection } from "./staff-unread-messages-section";

export function meta() {
  return [{ title: "事務局のダッシュボード | i-Club 予約システム" }];
}

/**
 * 事務局の画面のダッシュボード（SCR-022 / ADR-016 決定 8）。
 *
 * 事務局でない人が開こうとしたときは 403 Forbidden にする。
 * 区画は読めなくても画面を開く作りなので、先に確かめないと区画が空のダッシュボードを見せてしまう。
 * 区画が読めなかったときの扱いは、利用者の画面のダッシュボード（`app/routes/home/route.tsx`）と同じ。
 */
export async function loader({ context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const { user, actsAsStaff } = await requireAreaUser(context, AppArea.Staff, "staff-home.loader");

  const db = createDb(env.DB);
  const now = new Date();
  const ctx: LoadContext = { db, user, now, actsAsStaff };

  // 区画どうしは互いの結果を使わないので、D1 への問い合わせを並べて待つ
  const [pending, unlockRequired, unreadMessages, pendingGroups, today] = await Promise.all([
    loadStaffPending(ctx),
    loadStaffUnlockRequired(ctx),
    loadStaffUnreadMessages(ctx),
    loadPendingGroups(ctx),
    loadStaffToday(ctx),
  ]);

  return {
    // 相対時刻（「25 分前」など）をサーバーとブラウザで食い違わせないよう、今の時刻をここで決めて渡す
    now: now.toISOString(),
    pending,
    unlockRequired,
    unreadMessages,
    pendingGroups,
    today,
  };
}

/** 区画の読み込みに渡すもの */
interface LoadContext {
  readonly db: Database;
  readonly user: SessionUser;
  readonly now: Date;
  readonly actsAsStaff: boolean;
}

/** 承認待ちの予約と、その件数（UC-006） */
const loadStaffPending = ({ db, user, now, actsAsStaff }: LoadContext) =>
  loadSection(
    "staff-home.loader.staffPending",
    user,
    findStaffPendingReservations(db, { isStaff: actsAsStaff, now }),
  );

/** 解錠の手配が要る予約と、その件数（SCR-022 (4) / COND-027 (4)） */
const loadStaffUnlockRequired = ({ db, user, now, actsAsStaff }: LoadContext) =>
  loadSection(
    "staff-home.loader.staffUnlockRequired",
    user,
    findStaffUnlockRequiredReservations(db, { isStaff: actsAsStaff, now }),
  );

/** 団体からの未読メッセージ（UC-037 / COND-026 (3)） */
const loadStaffUnreadMessages = ({ db, user, now, actsAsStaff }: LoadContext) =>
  loadSection(
    "staff-home.loader.staffUnread",
    user,
    findStaffUnreadMessages(db, { actorUserId: user.id, isStaff: actsAsStaff, now }),
  );

/**
 * 有効化を待っている団体と、その数（UC-014）。
 *
 * 承認待ちで絞ると、団体の一覧は登録が古い順に並ぶ（`app/query/group/group-search.ts`）。
 * 待たせている団体から片付けられるよう、その並びのまま先頭の数件を出す。
 */
const loadPendingGroups = async ({ db, user, actsAsStaff }: LoadContext) => {
  const groups = await loadSection(
    "staff-home.loader.pendingGroups",
    user,
    findGroupSearchList(db, { isStaff: actsAsStaff, status: GroupStatus.Pending }),
  );
  return groups === null
    ? null
    : { items: groups.slice(0, STAFF_PENDING_GROUPS_LIMIT), totalCount: groups.length };
};

/** 今日の予約状況（UC-001） */
const loadStaffToday = ({ db, user, now, actsAsStaff }: LoadContext) =>
  loadSection(
    "staff-home.loader.staffToday",
    user,
    findStaffTodaySchedule(db, { isStaff: actsAsStaff, now }),
  );

/**
 * ダッシュボードからの操作（仮予約の承認/却下・確認済みにする）を受ける。
 *
 * どれも画面の一部の行だけを変えるので、`useFetcher` から送られてくる。
 * 成功したら `{ ok: true }` を返し、React Router が loader を読み直して行を消す。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const { user, actsAsStaff } = await requireAreaUser(context, AppArea.Staff, "staff-home.action");
  const formData = await request.formData();
  const intent = formData.get("intent");
  const db = createDb(env.DB);
  const now = new Date();

  /*
   * 事務局による仮予約の承認・却下（UC-006）。受け付ける操作は空き状況の画面と同じく
   * 事務局だけの操作に絞り、誰がどの予約にできるかはユースケースに任せる。
   * 事務局でない人が送ってきても、ユースケースが Forbidden で弾いてログに残す。
   */
  const transition = parseReservationTransition(intent);
  if (transition !== null && isStaffTransition(transition)) {
    const reservationId = readFormText(formData, "reservationId");
    const reason = formData.get("reason");

    const where = `staff-home.action.${transition}`;
    const result = await changeReservationStatus(db, request, user, {
      reservationId,
      transition,
      reason,
      rejectReservationIds: formData.getAll("rejectReservationId"),
      unlockArrangement: formData.get("unlockArrangement"),
      message: formData.get("message"),
      now,
      actsAsStaff,
      where,
    });

    if (result.isErr()) {
      return reservationActionErrors({ where, userId: user.id }, result.error);
    }
    return { ok: true } as const;
  }

  // 予約 1 件を確認済みにする（UC-037）
  if (intent === HomeIntent.MarkRead) {
    return markReservationRead({
      db,
      user,
      formData,
      now,
      where: "staff-home.action.mark-read",
      actsAsStaff,
    });
  }

  return { formError: "この操作は受け付けられませんでした。画面を読み込み直してください。" };
}

/**
 * 事務局の画面のダッシュボード（SCR-022 / ADR-016 決定 8）。
 *
 * 事務局の仕事（承認待ち・団体からのメッセージ・有効化を待っている団体・今日の予約）を出す。
 * 事務局が所属している団体についての区画は出さない。それは利用者の画面（`/`）で見る。
 */
export default function StaffHome({ loaderData }: Route.ComponentProps) {
  const { pending, unlockRequired, unreadMessages, pendingGroups, today } = loaderData;
  const now = new Date(loaderData.now);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <DashboardHeader now={now} area={AppArea.Staff} />

      <StaffTilesSection
        counts={{
          pendingReservations:
            pending === null
              ? null
              : { total: pending.totalCount, shortNotice: pending.shortNoticeCount },
          unlockRequired: unlockRequired?.totalCount ?? null,
          // 行と同じく、未読のある予約の数を数える（COND-026 (1)）
          unreadMessages: unreadMessages?.allUnreadReservationIds.length ?? null,
          pendingGroups:
            pendingGroups === null
              ? null
              : { total: pendingGroups.totalCount, oldest: pendingGroups.items[0] ?? null },
        }}
      />

      <StaffPendingSection
        reservations={pending?.items ?? []}
        totalCount={pending?.totalCount ?? 0}
        isUnavailable={pending === null}
        now={now}
      />

      <StaffUnlockRequiredSection
        reservations={unlockRequired?.items ?? []}
        totalCount={unlockRequired?.totalCount ?? 0}
        isUnavailable={unlockRequired === null}
      />

      <StaffUnreadMessagesSection
        items={unreadMessages?.items ?? []}
        overflowCount={unreadMessages?.overflowCount ?? 0}
        isUnavailable={unreadMessages === null}
        now={now}
      />

      <StaffPendingGroupsSection
        groups={pendingGroups?.items ?? []}
        totalCount={pendingGroups?.totalCount ?? 0}
        isUnavailable={pendingGroups === null}
      />

      <StaffTodayScheduleSection
        facilities={today?.facilities ?? []}
        reservations={today?.reservations ?? []}
        isUnavailable={today === null}
        now={now}
      />
    </main>
  );
}
