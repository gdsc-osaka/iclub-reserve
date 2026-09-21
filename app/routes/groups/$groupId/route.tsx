import { env } from "cloudflare:workers";
import { data, isRouteErrorResponse, Link, redirect } from "react-router";

import { GroupStatusBadge } from "~/components/group/group-status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { GroupErrorCode } from "~/domain/group";
import { createDb } from "~/infra/db";
import { createGroupInvitationListQuery } from "~/infra/group/group-invitation-list-query";
import { createGroupMemberListQuery } from "~/infra/group/group-member-list-query";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { logServerError } from "~/lib/log.server";
import { getGroupManagementUseCase } from "~/usecases/group/get-group-management";
import { removeMemberUseCase } from "~/usecases/group/remove-member";
import { updateGroupNameUseCase } from "~/usecases/group/update-group-name";
import { updateMemberRoleUseCase } from "~/usecases/group/update-member-role";

import type { Route } from "./+types/route";
import type { GroupActionData } from "./action-data";
import { toActionErrors, toGroupErrorMessage } from "./action-error";
import { GroupInfoCard } from "./group-info-card";
import { GroupInvitationCard } from "./group-invitation-card";
import { GroupMemberCard } from "./group-member-card";

export function meta({ loaderData }: Route.MetaArgs) {
  // 団体を取得できなかったとき（エラー画面）は loaderData が undefined になる
  return [
    {
      title: loaderData?.view
        ? `${loaderData.view.group.name} | iclub-reserve`
        : "団体情報 | iclub-reserve",
    },
  ];
}

/**
 * 団体管理画面（SCR-007）のローダー。
 *
 * 閲覧権限（所属メンバーまたは事務局スタッフ）を確認し、団体情報・所属メンバー・承諾待ち招待を取得する。
 * 所属していない人には存在自体を伏せるため、権限不足ではなく 404 を返す（COND-011 存在の秘匿）。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const groupId = params.groupId;

  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);
  const now = new Date();
  const db = createDb(env.DB);

  const result = await getGroupManagementUseCase(
    {
      groupRepository: createGroupRepository(db),
      membershipRepository: createMembershipRepository(db),
      groupMemberListQuery: createGroupMemberListQuery(db),
      groupInvitationListQuery: createGroupInvitationListQuery(db),
    },
    {
      groupId,
      actorUserId: user.id,
      isStaff: user.is_staff,
      now,
    },
  );

  if (result.isErr()) {
    const error = result.error;

    if (error.code === GroupErrorCode.GroupNotFound) {
      throw data({ message: "Group not found" }, { status: 404 });
    }

    /*
     * 予期せぬ内部エラーは利用者に内部事情を漏らさないようログに残し、500 を返す。
     */
    logServerError("groups.detail.loader", error);
    throw data({ message: "Internal server error" }, { status: 500 });
  }

  return {
    view: result.value,
    now,
    currentUserId: user.id,
  };
}

/**
 * 団体管理画面のアクション。
 *
 * 団体名の編集、メンバーの役割変更（昇格・降格）、メンバーの削除などの更新操作を処理する。
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const formData = await request.formData();
  const intent = formData.get("intent");

  const db = createDb(env.DB);

  // 1. 団体名の変更
  if (intent === "update-group-name") {
    const rawName = formData.get("name");
    const submittedName = typeof rawName === "string" ? rawName : "";

    const result = await updateGroupNameUseCase(
      {
        groupRepository: createGroupRepository(db),
        membershipRepository: createMembershipRepository(db),
      },
      {
        groupId: params.groupId,
        actorUserId: user.id,
        isStaff: user.is_staff,
        name: submittedName,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      const error = result.error;

      /*
       * 「見つからない」は GET と同じ応答（404）にそろえる（COND-011 存在の秘匿）。
       * ローダーが 404 を返す状況で action だけ 200 を返すと、
       * 応答ステータスの違いから団体の有無を外部から推測できてしまうため。
       */
      if (error.code === GroupErrorCode.GroupNotFound) {
        throw data({ message: "Group not found" }, { status: 404 });
      }

      // 差し戻し（入力の誤り・権限）は想定内なのでログに残さない
      if (error.code === GroupErrorCode.DatabaseError) {
        logServerError("groups.detail.action", error);
      }

      return {
        section: "name",
        submittedName,
        ...toActionErrors(error),
      } satisfies GroupActionData;
    }

    // 同じ内容の再送信を防ぐ PRG。戻ったあとはローダーが新しい名前を読み直す
    return redirect(".");
  }

  // 2. メンバーの役割変更（昇格・降格）
  if (intent === "update-member-role") {
    const rawUserId = formData.get("user_id");
    const targetUserId = typeof rawUserId === "string" ? rawUserId : "";
    const rawRole = formData.get("role");
    const role = typeof rawRole === "string" ? rawRole : "";

    const result = await updateMemberRoleUseCase(
      {
        membershipRepository: createMembershipRepository(db),
      },
      {
        groupId: params.groupId,
        actorUserId: user.id,
        isStaff: user.is_staff,
        targetUserId,
        role,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      const error = result.error;

      if (error.code === GroupErrorCode.GroupNotFound) {
        throw data({ message: "Group not found" }, { status: 404 });
      }

      if (error.code === GroupErrorCode.DatabaseError) {
        logServerError("groups.detail.action", error);
      }

      return {
        section: "members",
        error: toGroupErrorMessage(error),
      } satisfies GroupActionData;
    }

    return redirect(".");
  }

  // 3. メンバーの削除
  if (intent === "remove-member") {
    const rawUserId = formData.get("user_id");
    const targetUserId = typeof rawUserId === "string" ? rawUserId : "";

    const result = await removeMemberUseCase(
      {
        membershipRepository: createMembershipRepository(db),
      },
      {
        groupId: params.groupId,
        actorUserId: user.id,
        isStaff: user.is_staff,
        targetUserId,
      },
    );

    if (result.isErr()) {
      const error = result.error;

      if (error.code === GroupErrorCode.GroupNotFound) {
        throw data({ message: "Group not found" }, { status: 404 });
      }

      if (error.code === GroupErrorCode.DatabaseError) {
        logServerError("groups.detail.action", error);
      }

      return {
        section: "members",
        error: toGroupErrorMessage(error),
      } satisfies GroupActionData;
    }

    /*
     * 自分自身を削除した場合の遷移先:
     * 事務局スタッフではない一般利用者が自分を削除した場合、その団体への所属権限を失う。
     * そのまま "."（この画面）にリダイレクトすると、閲覧権限がないためローダーが 404 を返し、
     * 操作は正常に成功したにもかかわらず「団体が見つかりません」というエラー画面が表示されてしまう。
     * 利用者に失敗したような誤解を与えないよう、ホーム画面（"/"）へ戻す。
     */
    if (result.value.removedUserId === user.id && !user.is_staff) {
      return redirect("/");
    }

    return redirect(".");
  }

  // この画面が出している操作以外は受け付けない
  return {
    section: "name",
    submittedName: "",
    nameError: null,
    formError: "不正な操作です。",
  } satisfies GroupActionData;
}

/**
 * 団体管理画面（SCR-007）。
 *
 * 団体の基本情報、所属メンバー一覧、および承諾待ちの招待（管理者・事務局のみ）を表示する。
 */
export default function GroupManagementRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { view, now, currentUserId } = loaderData;
  const nowDate = new Date(now);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 md:py-10">
      {/* ページ見出し */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {view.group.name}
          </h1>
          <GroupStatusBadge status={view.group.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          団体の基本情報と所属メンバーを確認できます。
        </p>
      </div>

      {/* 団体情報カード */}
      <GroupInfoCard
        group={view.group}
        canManage={view.canManage}
        nameForm={actionData?.section === "name" ? actionData : null}
      />

      {/* メンバーカード */}
      <GroupMemberCard
        view={view}
        currentUserId={currentUserId}
        error={actionData?.section === "members" ? actionData.error : null}
      />

      {/* 承諾待ちの招待カード（管理者・事務局にだけ表示） */}
      {view.canManage && <GroupInvitationCard invitations={view.invitations} now={nowDate} />}
    </main>
  );
}

/**
 * このルートで例外が起きたときに出す画面。
 *
 * ローダーが投げた 404 / 500 をここで受け取り、利用者向けの日本語の案内に置き換える。
 * COND-011（存在の秘匿）に基づき、404 時は所属有無を問わず存在しない場合と同じ文言で案内する。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isNotFound ? "団体が見つかりません" : "団体情報を表示できません"}
          </CardTitle>
          <CardDescription>
            {isNotFound
              ? "URL が間違っているか、指定された団体は存在しない可能性があります。"
              : "時間をおいて、もう一度お試しください。"}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <Link to="/" className="text-sm text-primary underline underline-offset-4">
            ホームへ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
