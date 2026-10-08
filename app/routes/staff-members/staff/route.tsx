import { env } from "cloudflare:workers";
import { CircleAlert } from "lucide-react";
import { isRouteErrorResponse, Link, redirect } from "react-router";

import { Button } from "~/components/ui/button";
import { StaffField } from "~/domain/staff";
import { createDb } from "~/infra/db";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { createStaffInvitationRepository } from "~/infra/staff/staff-invitation-repo";
import { createStaffManagementQuery } from "~/infra/staff/staff-management-query";
import { createStaffMemberRepository } from "~/infra/staff/staff-member-repo";
import { resolveAppBaseUrl } from "~/lib/app-url.server";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { staffActionErrors } from "~/routes/_shared/staff-error.server";
import { cancelStaffInvitationUseCase } from "~/usecases/staff/cancel-staff-invitation";
import { getStaffManagementUseCase } from "~/usecases/staff/get-staff-management";
import { inviteStaffUseCase } from "~/usecases/staff/invite-staff";
import { revokeStaffUseCase } from "~/usecases/staff/revoke-staff";

import type { Route } from "./+types/route";
import type { StaffActionData } from "./action-data";
import { StaffInvitationCard } from "./staff-invitation-card";
import { StaffMemberCard } from "./staff-member-card";

export function meta() {
  return [{ title: "事務局の管理 | iclub-reserve" }];
}

/**
 * 事務局管理画面（SCR-019）のローダー。
 *
 * 閲覧権限（事務局スタッフ）を確認し、事務局一覧と承諾待ち招待を取得する。
 */
export async function loader({ context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);
  const db = createDb(env.DB);

  const result = await getStaffManagementUseCase(
    { staffManagementQuery: createStaffManagementQuery(db) },
    { actorUserId: user.id, isStaff: user.is_staff },
  );

  if (result.isErr()) {
    throw queryErrorResponse(
      { where: "staff-members.staff.loader", userId: user.id },
      result.error,
    );
  }

  return {
    view: result.value,
    currentUserId: user.id,
    now: new Date(),
  };
}

/**
 * 事務局管理画面（SCR-019）のアクション。
 *
 * 事務局招待の送信、招待取り消し、事務局権限の剥奪を処理する。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const db = createDb(env.DB);

  const contextOf = (operation: string) => ({
    where: `staff-members.staff.${operation}`,
    userId: user.id,
  });

  // 1. 事務局への招待送信
  if (intent === "invite-staff") {
    const rawEmail = formData.get("email");
    const submittedEmail = typeof rawEmail === "string" ? rawEmail : "";

    const result = await inviteStaffUseCase(
      {
        staffMemberRepository: createStaffMemberRepository(db),
        staffInvitationRepository: createStaffInvitationRepository(db),
        mailOutboxNotifier: createQueueMailOutboxNotifier(),
      },
      {
        actorUserId: user.id,
        isStaff: user.is_staff,
        email: submittedEmail,
        now: new Date(),
        appBaseUrl: resolveAppBaseUrl(request),
      },
    );

    if (result.isErr()) {
      return {
        section: "invite",
        submittedEmail,
        ...staffActionErrors(contextOf("invite-staff"), result.error, {
          [StaffField.Email]: "emailError",
        }),
      } satisfies StaffActionData;
    }

    return redirect(".");
  }

  // 2. 招待の取り消し
  if (intent === "cancel-staff-invitation") {
    const rawInvitationId = formData.get("invitation_id");
    const invitationId = typeof rawInvitationId === "string" ? rawInvitationId : "";

    const result = await cancelStaffInvitationUseCase(
      {
        staffInvitationRepository: createStaffInvitationRepository(db),
      },
      {
        actorUserId: user.id,
        isStaff: user.is_staff,
        invitationId,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      return {
        section: "invitations",
        ...staffActionErrors(contextOf("cancel-staff-invitation"), result.error),
      } satisfies StaffActionData;
    }

    return redirect(".");
  }

  // 3. 事務局権限の剥奪
  if (intent === "revoke-staff") {
    const rawUserId = formData.get("user_id");
    const targetUserId = typeof rawUserId === "string" ? rawUserId : "";

    const result = await revokeStaffUseCase(
      {
        staffMemberRepository: createStaffMemberRepository(db),
      },
      {
        actorUserId: user.id,
        isStaff: user.is_staff,
        targetUserId,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      return {
        section: "members",
        ...staffActionErrors(contextOf("revoke-staff"), result.error),
      } satisfies StaffActionData;
    }

    /*
     * 自分自身を剥奪した場合:
     * この画面を含む事務局画面を開けなくなるため、ホーム画面（"/"）へ戻す。
     */
    if (result.value.revokedSelf) {
      return redirect("/");
    }

    return redirect(".");
  }

  return redirect(".");
}

export default function StaffMembersRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { view, currentUserId, now } = loaderData;

  const membersError = actionData?.section === "members" ? actionData.formError : null;
  const inviteFormState = actionData?.section === "invite" ? actionData : null;
  const invitationsError = actionData?.section === "invitations" ? actionData.formError : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 画面ヘッダー */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">事務局の管理</h1>
        <p className="text-sm text-muted-foreground">
          事務局スタッフの一覧確認、招待の送信・取り消し、および権限の剥奪を行えます。
        </p>
      </div>

      {/* カード 2 枚のグリッドレイアウト */}
      <div className="grid gap-6 md:grid-cols-2 items-start">
        {/* 1. 事務局一覧カード */}
        <StaffMemberCard
          members={view.members}
          currentUserId={currentUserId}
          error={membersError}
        />

        {/* 2. 事務局招待カード */}
        <StaffInvitationCard
          invitations={view.pendingInvitations}
          now={new Date(now)}
          inviteForm={inviteFormState}
          error={invitationsError}
        />
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh] text-center">
        <CircleAlert className="size-12 text-destructive mb-4" />
        <h1 className="text-2xl font-bold">事務局スタッフ専用ページです</h1>
        <p className="text-muted-foreground mt-2 max-w-md">
          このページの閲覧には事務局スタッフの権限が必要です。アカウントをご確認ください。
        </p>
        <Button asChild className="mt-6">
          <Link to="/">ホームに戻る</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 min-h-[50vh] text-center">
      <CircleAlert className="size-12 text-destructive mb-4" />
      <h1 className="text-2xl font-bold">エラーが発生しました</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        事務局情報の読み込みに失敗しました。時間をおいてもう一度お試しください。
      </p>
      <Button onClick={() => window.location.reload()} className="mt-6">
        再読み込み
      </Button>
    </div>
  );
}
