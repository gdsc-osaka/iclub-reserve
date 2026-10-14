import { env } from "cloudflare:workers";
import { Calendar, CircleAlert, Plus } from "lucide-react";
import { Link } from "react-router";

import { toMyGroup, type MyGroup } from "~/components/group/my-group";
import { PendingGroupsNotice } from "~/components/group/pending-groups-notice";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { createDb } from "~/infra/db";
import { createUserInvitationsQuery } from "~/infra/group/user-invitations-query";
import { createInvitationRepository } from "~/infra/invitation/invitation-repo";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createGroupUnreadUpdatesQuery } from "~/infra/reservation/group-unread-updates-query";
import { createReservationReadRepository } from "~/infra/reservation/reservation-read-repo";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { formatMonthDay } from "~/lib/date";
import { invitationActionErrors } from "~/routes/_shared/group-error.server";
import { logQueryError } from "~/routes/_shared/query-error.server";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { acceptInvitationUseCase } from "~/usecases/group/accept-invitation";
import { listMyInvitationsUseCase } from "~/usecases/group/list-my-invitations";
import { rejectInvitationUseCase } from "~/usecases/group/reject-invitation";
import { getGroupUnreadUpdatesUseCase } from "~/usecases/reservation/get-group-unread-updates";
import { markAllReservationsReadUseCase } from "~/usecases/reservation/mark-all-reservations-read";
import { markReservationReadUseCase } from "~/usecases/reservation/mark-reservation-read";
import { listMyGroupsUseCase } from "~/usecases/user/list-my-groups";

import type { Route } from "./+types/route";
import { HomeIntent } from "./home-intent";
import { InboxSection } from "./inbox-section";
import { MyGroupsSection } from "./my-groups-section";

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
 */
export async function loader({ context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);
  const db = createDb(env.DB);
  const now = new Date();

  // 区画どうしは互いの結果を使わないので、D1 への問い合わせを並べて待つ
  const [groupsResult, unreadResult, invitationsResult] = await Promise.all([
    // 所属団体（承認待ちの団体の案内と、所属が無いときの案内に使う）
    listMyGroupsUseCase(
      { userGroupListQuery: createUserGroupListQuery(db) },
      { actorUserId: user.id },
    ),
    // 団体側の未読（UC-037 / COND-026）
    getGroupUnreadUpdatesUseCase(
      { groupUnreadUpdatesQuery: createGroupUnreadUpdatesQuery(db) },
      { actorUserId: user.id, now },
    ),
    // 自分宛ての招待（UC-022）
    listMyInvitationsUseCase(
      { userInvitationsQuery: createUserInvitationsQuery(db) },
      { actorEmail: user.email, now },
    ),
  ]);

  if (groupsResult.isErr()) {
    logQueryError({ where: "home.loader.groups", userId: user.id }, groupsResult.error);
  }
  if (unreadResult.isErr()) {
    logQueryError({ where: "home.loader.unread", userId: user.id }, unreadResult.error);
  }
  if (invitationsResult.isErr()) {
    logQueryError({ where: "home.loader.invitations", userId: user.id }, invitationsResult.error);
  }

  return {
    isStaff: user.is_staff,
    groups: groupsResult.isOk() ? groupsResult.value.map(toMyGroup) : ([] as readonly MyGroup[]),
    isGroupsUnavailable: groupsResult.isErr(),
    unreadReservations: unreadResult.isOk() ? unreadResult.value.items : [],
    overflowCount: unreadResult.isOk() ? unreadResult.value.overflowCount : 0,
    invitations: invitationsResult.isOk() ? invitationsResult.value : [],
    isInboxUnavailable: unreadResult.isErr() || invitationsResult.isErr(),
    // 相対時刻（「25 分前」など）をサーバーとブラウザで食い違わせないよう、今の時刻をここで決めて渡す
    now: now.toISOString(),
  };
}

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

/**
 * ログイン後に最初に開く画面（SCR-022）。
 *
 * 所属している団体を横断して、いま自分に関係することをまとめて出す。
 * 団体を切り替えて見る形にしていないのは、複数の団体を掛け持ちしている人が多く、
 * 切り替えを忘れたまま「予約が無い」と勘違いするのを避けたいため。
 *
 * NOTE: SCR-022 のうち「今後の予約」「団体の最近の動き」と事務局向けの区画は、まだ作っていない（#176）。
 * 所属団体の区画は SCR-022 から外したので、それらを足すときに消す。
 */
export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    isStaff,
    groups,
    isGroupsUnavailable,
    unreadReservations,
    overflowCount,
    invitations,
    isInboxUnavailable,
    now,
  } = loaderData;

  const nowDate = new Date(now);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <DashboardHeader now={nowDate} isStaff={isStaff} />

      {isGroupsUnavailable && <GroupsUnavailableAlert />}

      {/* 承認待ちの団体がカードに出ていない 5 件目以降でも、ここには必ず名前が出る */}
      <PendingGroupsNotice groups={groups} />

      <InboxSection
        unreadReservations={unreadReservations}
        overflowCount={overflowCount}
        invitations={invitations}
        isUnavailable={isInboxUnavailable}
        now={nowDate}
      />

      <MyGroupsSection groups={groups} isUnavailable={isGroupsUnavailable} />
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
