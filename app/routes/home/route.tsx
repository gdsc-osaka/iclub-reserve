import { env } from "cloudflare:workers";
import { Calendar, CircleAlert, Plus } from "lucide-react";
import { Link } from "react-router";

import { toMyGroup, type MyGroup } from "~/components/group/my-group";
import { NoGroupsCard } from "~/components/group/my-group-card";
import { PendingGroupsNotice } from "~/components/group/pending-groups-notice";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { GroupStatus, STAFF_PENDING_GROUPS_LIMIT } from "~/domain/group";
import { isStaffTransition, parseReservationTransition } from "~/domain/reservation/transition";
import { createGroupRecentActivitiesQuery } from "~/infra/audit-log/group-recent-activities-query";
import { createDb, type Database } from "~/infra/db";
import { createInvitationRepository } from "~/infra/invitation/invitation-repo";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationListQuery } from "~/infra/reservation/reservation-list-query";
import { createReservationReadRepository } from "~/infra/reservation/reservation-read-repo";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { requireRequestUser, type SessionUser } from "~/lib/auth/auth-session.server";
import { formatMonthDay } from "~/lib/date";
import { findGroupSearchList } from "~/query/group/group-search";
import { findUserInvitations } from "~/query/group/user-invitations";
import {
  createGroupUnreadUpdatesQuery,
  findGroupUnreadUpdates,
} from "~/query/reservation/group-unread-updates";
import { findStaffPendingReservations } from "~/query/reservation/staff-pending-reservations";
import { findStaffTodaySchedule } from "~/query/reservation/staff-today-schedule";
import { findStaffUnreadMessages } from "~/query/reservation/staff-unread-messages";
import { createUserGroupListQuery, findUserGroupList } from "~/query/user/user-group-list";
import { invitationActionErrors } from "~/routes/_shared/group-error.server";
import { logQueryError } from "~/routes/_shared/query-error.server";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { changeReservationStatus } from "~/routes/_shared/reservation-transition.server";
import { getGroupRecentActivitiesUseCase } from "~/usecases/audit-log/get-group-recent-activities";
import { acceptInvitationUseCase } from "~/usecases/group/accept-invitation";
import { rejectInvitationUseCase } from "~/usecases/group/reject-invitation";
import { listUpcomingReservationsUseCase } from "~/usecases/reservation/list-upcoming-reservations";
import { markAllReservationsReadUseCase } from "~/usecases/reservation/mark-all-reservations-read";
import { markReservationReadUseCase } from "~/usecases/reservation/mark-reservation-read";

import type { Route } from "./+types/route";
import { HomeIntent } from "./home-intent";
import { InboxSection } from "./inbox-section";
import { RecentActivitySection } from "./recent-activity-section";
import { StaffPendingGroupsSection } from "./staff-pending-groups-section";
import { StaffPendingSection } from "./staff-pending-section";
import { StaffTilesSection } from "./staff-tiles-section";
import { StaffTodayScheduleSection } from "./staff-today-schedule-section";
import { StaffUnreadMessagesSection } from "./staff-unread-messages-section";
import { UpcomingSection } from "./upcoming-section";

export function meta() {
  return [{ title: "ダッシュボード | iclub-reserve" }];
}

/**
 * ダッシュボードに出すデータを取得する。
 *
 * この画面はログイン後の最初の行き先なので、区画の一部が読めなくても他の区画を出せるようにする。
 * 障害で 500 を返すと、ログインした人が画面を一切使えなくなるため。
 * 失敗はどれも `logQueryError` でログに残す。握りつぶすと、D1 の障害で読めていないのか、
 * そもそも中身が無いのかを、あとから区別する手がかりが残らない。
 *
 * 事務局と一般ユーザーとで出す区画が違う（SCR-022）。事務局でない人には、
 * 事務局向けの問い合わせを 1 つも走らせない。
 */
export async function loader({ context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);
  const db = createDb(env.DB);
  const now = new Date();

  if (user.is_staff) {
    // 区画どうしは互いの結果を使わないので、D1 への問い合わせを並べて待つ
    const [groups, invitations, pending, unreadMessages, pendingGroups, today] = await Promise.all([
      loadMyGroups(db, user),
      // 団体に所属していない事務局にも、団体への招待は届く
      loadInvitations(db, user, now),
      loadStaffPending(db, user, now),
      loadStaffUnreadMessages(db, user, now),
      loadPendingGroups(db, user),
      loadStaffToday(db, user, now),
    ]);

    // 団体側の未読と今後の予約は、団体に所属しているときだけ読む（所属が無ければ必ず空なので省く）
    const [groupUnread, upcoming] =
      groups.groups.length > 0
        ? await Promise.all([loadGroupUnread(db, user, now), loadUpcoming(db, user, now)])
        : [null, null];

    return {
      isStaff: true as const,
      // 相対時刻（「25 分前」など）をサーバーとブラウザで食い違わせないよう、今の時刻をここで決めて渡す
      now: now.toISOString(),
      groups,
      invitations,
      groupUnread,
      upcoming,
      pending,
      unreadMessages,
      pendingGroups,
      today,
    };
  }

  const [groups, invitations, groupUnread, upcoming, recentActivities] = await Promise.all([
    loadMyGroups(db, user),
    loadInvitations(db, user, now),
    loadGroupUnread(db, user, now),
    loadUpcoming(db, user, now),
    loadRecentActivities(db, user, now),
  ]);

  return {
    isStaff: false as const,
    now: now.toISOString(),
    groups,
    invitations,
    groupUnread,
    upcoming,
    recentActivities,
  };
}

/*
 * 以下は区画ごとの読み込み。どれも失敗をログに残したうえで、読めなかったことを
 * 区画の値（null など）として返す。例外にはしない。区画は「読めなかった」案内を自分で出す。
 */

/** 所属団体（承認待ちの団体の案内と、所属が無いときの案内、事務局の「自分の団体」に使う） */
const loadMyGroups = async (db: Database, user: SessionUser) => {
  const result = await findUserGroupList(db, { actorUserId: user.id });
  if (result.isErr()) {
    logQueryError({ where: "home.loader.groups", userId: user.id }, result.error);
  }
  return {
    groups: result.isOk() ? result.value.map(toMyGroup) : ([] as readonly MyGroup[]),
    isUnavailable: result.isErr(),
  };
};

/** 自分宛ての招待（UC-022）。null は読めなかったことを表す */
const loadInvitations = async (db: Database, user: SessionUser, now: Date) => {
  const result = await findUserInvitations(db, { actorEmail: user.email, now });
  if (result.isErr()) {
    logQueryError({ where: "home.loader.invitations", userId: user.id }, result.error);
    return null;
  }
  return result.value;
};

/** 団体側の未読（UC-037 / COND-026 (2)）。null は読めなかったことを表す */
const loadGroupUnread = async (db: Database, user: SessionUser, now: Date) => {
  const result = await findGroupUnreadUpdates(db, { actorUserId: user.id, now });
  if (result.isErr()) {
    logQueryError({ where: "home.loader.unread", userId: user.id }, result.error);
    return null;
  }
  return result.value;
};

/** 今後の予約（UC-032）。null は読めなかったことを表す */
const loadUpcoming = async (db: Database, user: SessionUser, now: Date) => {
  const result = await listUpcomingReservationsUseCase(
    {
      userGroupListQuery: createUserGroupListQuery(db),
      reservationListQuery: createReservationListQuery(db),
    },
    { actorUserId: user.id, now },
  );
  if (result.isErr()) {
    logQueryError({ where: "home.loader.upcoming", userId: user.id }, result.error);
    return null;
  }
  return result.value;
};

/** 団体の最近の動き（UC-025）。null は読めなかったことを表す */
const loadRecentActivities = async (db: Database, user: SessionUser, now: Date) => {
  const result = await getGroupRecentActivitiesUseCase(
    {
      userGroupListQuery: createUserGroupListQuery(db),
      groupRecentActivitiesQuery: createGroupRecentActivitiesQuery(db),
    },
    { actorUserId: user.id, isStaff: user.is_staff, now },
  );
  if (result.isErr()) {
    logQueryError({ where: "home.loader.recentActivities", userId: user.id }, result.error);
    return null;
  }
  return result.value;
};

/** 承認待ちの予約と、その件数（UC-006）。null は読めなかったことを表す */
const loadStaffPending = async (db: Database, user: SessionUser, now: Date) => {
  const result = await findStaffPendingReservations(db, { isStaff: user.is_staff, now });
  if (result.isErr()) {
    logQueryError({ where: "home.loader.staffPending", userId: user.id }, result.error);
    return null;
  }
  return result.value;
};

/** 団体からの未読メッセージ（UC-037 / COND-026 (3)）。null は読めなかったことを表す */
const loadStaffUnreadMessages = async (db: Database, user: SessionUser, now: Date) => {
  const result = await findStaffUnreadMessages(db, {
    actorUserId: user.id,
    isStaff: user.is_staff,
    now,
  });
  if (result.isErr()) {
    logQueryError({ where: "home.loader.staffUnread", userId: user.id }, result.error);
    return null;
  }
  return result.value;
};

/**
 * 有効化を待っている団体と、その数（UC-014）。null は読めなかったことを表す。
 *
 * 承認待ちで絞ると、団体の一覧は登録が古い順に並ぶ（`app/query/group/group-search.ts`）。
 * 待たせている団体から片付けられるよう、その並びのまま先頭の数件を出す。
 */
const loadPendingGroups = async (db: Database, user: SessionUser) => {
  const result = await findGroupSearchList(db, {
    isStaff: user.is_staff,
    status: GroupStatus.Pending,
  });
  if (result.isErr()) {
    logQueryError({ where: "home.loader.pendingGroups", userId: user.id }, result.error);
    return null;
  }
  return {
    items: result.value.slice(0, STAFF_PENDING_GROUPS_LIMIT),
    totalCount: result.value.length,
  };
};

/** 今日の予約状況（UC-001）。null は読めなかったことを表す */
const loadStaffToday = async (db: Database, user: SessionUser, now: Date) => {
  const result = await findStaffTodaySchedule(db, { isStaff: user.is_staff, now });
  if (result.isErr()) {
    logQueryError({ where: "home.loader.staffToday", userId: user.id }, result.error);
    return null;
  }
  return result.value;
};

/**
 * ダッシュボードからの操作（確認済みにする・招待への応答・仮予約の承認/却下）を受ける。
 *
 * どれも画面の一部の行だけを変えるので、`useFetcher` から送られてくる。
 * 成功したら `{ ok: true }` を返し、React Router が loader を読み直して行を消す。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
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
    const reservationId = String(formData.get("reservationId") ?? "");
    const reason = formData.get("reason");

    const result = await changeReservationStatus(db, request, user, {
      reservationId,
      transition,
      reason,
      now,
    });

    if (result.isErr()) {
      return reservationActionErrors(
        { where: `home.action.${transition}`, userId: user.id },
        result.error,
      );
    }
    return { ok: true } as const;
  }

  // 予約 1 件を確認済みにする（UC-037）
  if (intent === HomeIntent.MarkRead) {
    const result = await markReservationReadUseCase(
      {
        reservationReadRepository: createReservationReadRepository(db),
        reservationRepository: createReservationRepository(db),
        membershipRepository: createMembershipRepository(db),
      },
      {
        reservationId: String(formData.get("reservationId") ?? ""),
        actorUserId: user.id,
        isStaff: user.is_staff,
        now,
      },
    );

    if (result.isErr()) {
      return reservationActionErrors(
        { where: "home.action.mark-read", userId: user.id },
        result.error,
      );
    }
    return { ok: true } as const;
  }

  // 一覧に出ている予約をまとめて確認済みにする（UC-037）
  if (intent === HomeIntent.MarkAllRead) {
    const result = await markAllReservationsReadUseCase(
      {
        reservationReadRepository: createReservationReadRepository(db),
        groupUnreadUpdatesQuery: createGroupUnreadUpdatesQuery(db),
      },
      {
        reservationIds: formData
          .getAll("reservationId")
          .filter((value): value is string => typeof value === "string"),
        actorUserId: user.id,
        now,
      },
    );

    if (result.isErr()) {
      return reservationActionErrors(
        { where: "home.action.mark-all-read", userId: user.id },
        result.error,
      );
    }
    return { ok: true } as const;
  }

  // 招待を承諾する（UC-022）
  if (intent === HomeIntent.AcceptInvitation) {
    const result = await acceptInvitationUseCase(
      { invitationRepository: createInvitationRepository(db) },
      {
        invitationId: String(formData.get("invitationId") ?? ""),
        actorUserId: user.id,
        actorEmail: user.email,
        now,
      },
    );

    if (result.isErr()) {
      return invitationActionErrors(
        { where: "home.action.accept-invitation", userId: user.id },
        result.error,
      );
    }
    return { ok: true } as const;
  }

  // 招待を辞退する（UC-022）
  if (intent === HomeIntent.RejectInvitation) {
    const result = await rejectInvitationUseCase(
      { invitationRepository: createInvitationRepository(db) },
      {
        invitationId: String(formData.get("invitationId") ?? ""),
        actorUserId: user.id,
        actorEmail: user.email,
        now,
      },
    );

    if (result.isErr()) {
      return invitationActionErrors(
        { where: "home.action.reject-invitation", userId: user.id },
        result.error,
      );
    }
    return { ok: true } as const;
  }

  return { formError: "不正な操作です。" };
}

type HomeLoaderData = Route.ComponentProps["loaderData"];
type StaffLoaderData = Extract<HomeLoaderData, { isStaff: true }>;
type MemberLoaderData = Extract<HomeLoaderData, { isStaff: false }>;

/**
 * ログイン後に最初に開く画面（SCR-022）。
 *
 * 所属している団体を横断して、いま自分に関係することをまとめて出す。
 * 団体を切り替えて見る形にしていないのは、複数の団体を掛け持ちしている人が多く、
 * 切り替えを忘れたまま「予約が無い」と勘違いするのを避けたいため。
 *
 * 事務局には、団体の区画の代わりに事務局の仕事（承認待ち・団体からのメッセージ・有効化を待っている団体・
 * 今日の予約）を出す。
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const now = new Date(loaderData.now);

  return loaderData.isStaff ? (
    <StaffDashboard data={loaderData} now={now} />
  ) : (
    <MemberDashboard data={loaderData} now={now} />
  );
}

/** 一般ユーザーのダッシュボード */
function MemberDashboard({ data, now }: Readonly<{ data: MemberLoaderData; now: Date }>) {
  const { groups, invitations, groupUnread, upcoming, recentActivities } = data;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <DashboardHeader now={now} isStaff={false} />

      {groups.isUnavailable && <GroupsUnavailableAlert />}

      {/* 承認待ちの団体の案内 */}
      <PendingGroupsNotice groups={groups.groups} />

      {/* どの団体にも所属していない人への案内 */}
      {!groups.isUnavailable && groups.groups.length === 0 && <NoGroupsCard />}

      {/* 確認が必要なこと（団体側の未読・招待） */}
      <InboxSection
        unreadReservations={groupUnread?.items ?? []}
        overflowCount={groupUnread?.overflowCount ?? 0}
        invitations={invitations ?? []}
        isUnavailable={groupUnread === null || invitations === null}
        now={now}
      />

      {/* 今後の予約と団体の最近の動き（PC では横並び 3:2、スマホでは縦積み） */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <UpcomingSection
            reservations={upcoming ?? []}
            // 未読のある予約に印を付ける（一覧の 10 件を超えた分も含む）
            unreadReservationIds={new Set(groupUnread?.allUnreadReservationIds)}
            isUnavailable={upcoming === null}
            now={now}
          />
        </div>
        <div className="lg:col-span-2">
          <RecentActivitySection
            activities={recentActivities ?? []}
            isUnavailable={recentActivities === null}
            now={now}
          />
        </div>
      </div>
    </main>
  );
}

/** 事務局のダッシュボード */
function StaffDashboard({ data, now }: Readonly<{ data: StaffLoaderData; now: Date }>) {
  const {
    groups,
    invitations,
    groupUnread,
    upcoming,
    pending,
    unreadMessages,
    pendingGroups,
    today,
  } = data;

  /*
   * 団体に所属しているか、団体への招待が届いているときだけ「自分の団体」を出す。
   * 招待を読めなかったときも出す。届いているかどうか分からないまま隠すと、
   * 読めなかったことに気づけない（「確認が必要なこと」が読めなかった案内を出す）
   */
  const hasOwnGroup = groups.groups.length > 0;
  const showOwnGroup = hasOwnGroup || invitations === null || invitations.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <DashboardHeader now={now} isStaff />

      <StaffTilesSection
        counts={{
          pendingReservations:
            pending === null
              ? null
              : { total: pending.totalCount, shortNotice: pending.shortNoticeCount },
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

      {groups.isUnavailable && <GroupsUnavailableAlert />}

      {/* 事務局が団体にも所属しているときの、その団体についての区画。「団体の最近の動き」は出さない */}
      {showOwnGroup && (
        <section aria-labelledby="own-group-title" className="flex flex-col gap-6 border-t pt-6">
          <h2 id="own-group-title" className="text-lg font-bold tracking-tight">
            自分の団体
          </h2>

          <InboxSection
            unreadReservations={groupUnread?.items ?? []}
            overflowCount={groupUnread?.overflowCount ?? 0}
            invitations={invitations ?? []}
            isUnavailable={(hasOwnGroup && groupUnread === null) || invitations === null}
            now={now}
          />

          {hasOwnGroup && (
            <UpcomingSection
              reservations={upcoming ?? []}
              unreadReservationIds={new Set(groupUnread?.allUnreadReservationIds)}
              isUnavailable={upcoming === null}
              now={now}
            />
          )}
        </section>
      )}
    </main>
  );
}

/** 今日の日付と、よく使う画面への入口 */
function DashboardHeader({ now, isStaff }: Readonly<{ now: Date; isStaff: boolean }>) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-sm text-muted-foreground">{formatMonthDay(now)}</p>
        <h1 className="text-2xl font-bold tracking-tight">ダッシュボード</h1>
      </div>
      {/* スマホでは 2 つを 2 列・全幅に並べる */}
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button asChild variant="outline" size="lg">
          <Link to="/availability">
            <Calendar aria-hidden />
            空き状況を見る
          </Link>
        </Button>
        <Button asChild size="lg">
          <Link to="/reservations/new">
            <Plus aria-hidden />
            {/* 事務局は承認を待たずに作れる（UC-008）ので、文言を変える */}
            {isStaff ? "予約を作成" : "予約を申請"}
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** 団体の一覧を読めなかったときの案内 */
function GroupsUnavailableAlert() {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>所属している団体を読み込めませんでした</AlertTitle>
      <AlertDescription>
        時間をおいて、画面を再読み込みしてください。
        繰り返し表示される場合は事務局にご連絡ください。
      </AlertDescription>
    </Alert>
  );
}
