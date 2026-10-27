import { env } from "cloudflare:workers";
import { CircleAlert } from "lucide-react";

import { toMyGroup, type MyGroup } from "~/components/group/my-group";
import { NoGroupsCard } from "~/components/group/my-group-card";
import { PendingGroupsNotice } from "~/components/group/pending-groups-notice";
import { AppArea } from "~/components/layout/app-area";
import { StaffContact } from "~/components/layout/staff-contact";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { createGroupRecentActivitiesQuery } from "~/infra/audit-log/group-recent-activities-query";
import { createDb, type Database } from "~/infra/db";
import { createInvitationRepository } from "~/infra/invitation/invitation-repo";
import { createReservationListQuery } from "~/infra/reservation/reservation-list-query";
import { createReservationReadRepository } from "~/infra/reservation/reservation-read-repo";
import { requireRequestUser, type SessionUser } from "~/lib/auth/auth-session.server";
import { findUserInvitations } from "~/query/group/user-invitations";
import {
  createGroupUnreadUpdatesQuery,
  findGroupUnreadUpdates,
} from "~/query/reservation/group-unread-updates";
import { findUserGroupList, type UserGroupListQuery } from "~/query/user/user-group-list";
import { invitationActionErrors } from "~/routes/_shared/group-error.server";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { getGroupRecentActivitiesUseCase } from "~/usecases/audit-log/get-group-recent-activities";
import { acceptInvitationUseCase } from "~/usecases/group/accept-invitation";
import { rejectInvitationUseCase } from "~/usecases/group/reject-invitation";
import { listUpcomingReservationsUseCase } from "~/usecases/reservation/list-upcoming-reservations";
import { markAllReservationsReadUseCase } from "~/usecases/reservation/mark-all-reservations-read";

import type { Route } from "./+types/route";
import { DashboardHeader } from "./dashboard-header";
import { HomeIntent } from "./home-intent";
import { InboxSection } from "./inbox-section";
import { loadSection } from "./load-section.server";
import { markReservationRead } from "./mark-read.server";
import { readFormText } from "./read-form-text";
import { RecentActivitySection } from "./recent-activity-section";
import { UpcomingSection } from "./upcoming-section";

export function meta() {
  return [{ title: "ダッシュボード | i-Club 予約システム" }];
}

/**
 * 利用者の画面のダッシュボード（SCR-022 / ADR-016 決定 8）。
 *
 * この画面はログイン後の最初の行き先なので、区画の一部が読めなくても他の区画を出せるようにする。
 * 障害で 500 を返すと、ログインした人が画面を一切使えなくなるため。
 * 失敗はどれも `logQueryError` でログに残す。握りつぶすと、D1 の障害で読めていないのか、
 * そもそも中身が無いのかを、あとから区別する手がかりが残らない。
 *
 * 事務局が開いても、事務局でない人と同じ区画を出す。事務局の仕事は `/staff` に出す。
 */
export async function loader({ context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);
  const db = createDb(env.DB);
  const now = new Date();
  const ctx: LoadContext = { db, user, now, userGroupListQuery: shareUserGroupList(db, user) };

  const [groups, invitations, groupUnread, upcoming, recentActivities] = await Promise.all([
    loadMyGroups(ctx),
    loadInvitations(ctx),
    loadGroupUnread(ctx),
    loadUpcoming(ctx),
    loadRecentActivities(ctx),
  ]);

  return {
    // 相対時刻（「25 分前」など）をサーバーとブラウザで食い違わせないよう、今の時刻をここで決めて渡す
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

/** 区画の読み込みに渡すもの */
interface LoadContext {
  readonly db: Database;
  readonly user: SessionUser;
  readonly now: Date;
  /** 所属団体は 1 回だけ読んで使い回す（`shareUserGroupList`） */
  readonly userGroupListQuery: UserGroupListQuery;
}

/**
 * 本人の所属団体を 1 回だけ読む `UserGroupListQuery`。
 *
 * 所属団体は「自分の団体」の区画のほか、今後の予約と団体の最近の動きのユースケースも読む。
 * それぞれに読ませると同じ問い合わせが 3 回走るので、最初に読んだ結果を使い回す。
 */
const shareUserGroupList = (db: Database, user: SessionUser): UserGroupListQuery => {
  const groups = findUserGroupList(db, { actorUserId: user.id });
  return {
    findByUserId: (userId) =>
      userId === user.id ? groups : findUserGroupList(db, { actorUserId: userId }),
  };
};

/** 所属団体（承認待ちの団体の案内と、所属が無いときの案内に使う） */
const loadMyGroups = async ({ user, userGroupListQuery }: LoadContext) => {
  const groups = await loadSection(
    "home.loader.groups",
    user,
    userGroupListQuery.findByUserId(user.id),
  );
  return {
    groups: groups === null ? ([] as readonly MyGroup[]) : groups.map(toMyGroup),
    isUnavailable: groups === null,
  };
};

/** 自分宛ての招待（UC-022） */
const loadInvitations = ({ db, user, now }: LoadContext) =>
  loadSection(
    "home.loader.invitations",
    user,
    findUserInvitations(db, { actorEmail: user.email, now }),
  );

/** 団体側の未読（UC-037 / COND-026 (2)） */
const loadGroupUnread = ({ db, user, now }: LoadContext) =>
  loadSection(
    "home.loader.unread",
    user,
    findGroupUnreadUpdates(db, { actorUserId: user.id, now }),
  );

/** 今後の予約（UC-032） */
const loadUpcoming = ({ db, user, now, userGroupListQuery }: LoadContext) =>
  loadSection(
    "home.loader.upcoming",
    user,
    listUpcomingReservationsUseCase(
      { userGroupListQuery, reservationListQuery: createReservationListQuery(db) },
      { actorUserId: user.id, now },
    ),
  );

/** 団体の最近の動き（UC-025） */
const loadRecentActivities = ({ db, user, now, userGroupListQuery }: LoadContext) =>
  loadSection(
    "home.loader.recentActivities",
    user,
    getGroupRecentActivitiesUseCase(
      { userGroupListQuery, groupRecentActivitiesQuery: createGroupRecentActivitiesQuery(db) },
      {
        actorUserId: user.id,
        // 利用者の画面では、事務局も団体側の表示で読む（操作者を「事務局」と出す。COND-030 の (2)・ADR-016 決定 8）
        isStaff: false,
        now,
      },
    ),
  );

/**
 * ダッシュボードからの操作（確認済みにする・招待への応答）を受ける。
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

  // 予約 1 件を確認済みにする（UC-037）
  if (intent === HomeIntent.MarkRead) {
    return markReservationRead({ db, user, formData, now, where: "home.action.mark-read" });
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
        invitationId: readFormText(formData, "invitationId"),
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
        invitationId: readFormText(formData, "invitationId"),
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

  return { formError: "この操作は受け付けられませんでした。画面を読み込み直してください。" };
}

/**
 * 利用者の画面のダッシュボード（SCR-022 / ADR-016 決定 8）。
 *
 * 所属している団体を横断して、いま自分に関係することをまとめて出す。
 * 団体を切り替えて見る形にしていないのは、複数の団体を掛け持ちしている人が多く、
 * 切り替えを忘れたまま「予約が無い」と勘違いするのを避けたいため。
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const { groups, invitations, groupUnread, upcoming, recentActivities } = loaderData;
  const now = new Date(loaderData.now);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <DashboardHeader now={now} area={AppArea.User} />

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

/** 団体の一覧を読めなかったときの案内 */
function GroupsUnavailableAlert() {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>所属している団体を読み込めませんでした</AlertTitle>
      <AlertDescription>
        <p>
          時間をおいて、画面を読み込み直してください。繰り返し表示される場合は、
          <StaffContact />
          にお問い合わせください。
        </p>
      </AlertDescription>
    </Alert>
  );
}
