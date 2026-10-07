import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import { MembershipRoleBadge } from "~/components/group/membership-role-badge";
import { InvitationDetail } from "~/components/invitation/invitation-detail";
import { InvitationErrorCard } from "~/components/invitation/invitation-error-card";
import {
  InvitationIntent,
  type InvitationActionData,
} from "~/components/invitation/invitation-intent";
import { InvitationResponseCard } from "~/components/invitation/invitation-response-card";
import { createDb } from "~/infra/db";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createInvitationRepository } from "~/infra/invitation/invitation-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { formatDateTime } from "~/lib/date";
import {
  invitationActionErrors,
  invitationErrorResponse,
} from "~/routes/_shared/group-error.server";
import { acceptInvitationUseCase } from "~/usecases/group/accept-invitation";
import { getInvitationUseCase } from "~/usecases/group/get-invitation";
import { rejectInvitationUseCase } from "~/usecases/group/reject-invitation";

import type { Route } from "./+types/route";

export function meta(): Route.MetaDescriptors {
  return [{ title: "団体への招待 | iclub-reserve" }];
}

/**
 * 招待の承諾画面（SCR-016）のローダー。
 *
 * 招待メールのリンクから開いたユーザーに対して、招待元の団体名と役割、有効期限を表示する。
 * 宛先が一致しない場合や期限切れ・取り消し済みの場合は、存在秘匿のため 404 を返す（COND-011）。
 * ユースケースは宛先違いを `InvitationNotVisible` として正直に返し、404 に揃えるのは表の側である（ADR-004 決定 4）。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);
  const db = createDb(env.DB);
  const now = new Date();

  const result = await getInvitationUseCase(
    {
      invitationRepository: createInvitationRepository(db),
      groupRepository: createGroupRepository(db),
    },
    {
      invitationId: params.invitationId,
      actorEmail: user.email,
      now,
    },
  );

  if (result.isErr()) {
    // 存在しない・期限切れ・取り消し済み・宛先違いは、すべて同じ 404 になる（COND-011）
    throw invitationErrorResponse(
      { where: "invitations.accept.loader", userId: user.id },
      result.error,
    );
  }

  return { invitation: result.value };
}

/**
 * 招待の承諾画面のアクション。
 *
 * 「承諾」と「辞退」の 2 つの操作を受け付ける。
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const db = createDb(env.DB);
  const now = new Date();

  // 1. 承諾
  if (intent === InvitationIntent.Accept) {
    const result = await acceptInvitationUseCase(
      {
        invitationRepository: createInvitationRepository(db),
      },
      {
        invitationId: params.invitationId,
        actorUserId: user.id,
        actorEmail: user.email,
        now,
      },
    );

    if (result.isErr()) {
      /*
       * 「見つからない」は GET と同じ応答（404）を投げる（COND-011 存在の秘匿）。
       * ローダーが 404 を返す状況で action だけ 200 を返すと、
       * 応答ステータスの違いから招待の有無を外部から推測できてしまうため。
       */
      return invitationActionErrors(
        { where: "invitations.accept.action", userId: user.id },
        result.error,
      ) satisfies InvitationActionData;
    }

    // 承諾成功時は、参加した団体の詳細画面へ案内する
    return redirect(`/groups/${result.value.groupId}`);
  }

  // 2. 辞退
  if (intent === InvitationIntent.Reject) {
    const result = await rejectInvitationUseCase(
      {
        invitationRepository: createInvitationRepository(db),
      },
      {
        invitationId: params.invitationId,
        actorEmail: user.email,
        now,
      },
    );

    if (result.isErr()) {
      // 承諾と同じく、「見つからない」は 404 を投げる
      return invitationActionErrors(
        { where: "invitations.reject.action", userId: user.id },
        result.error,
      ) satisfies InvitationActionData;
    }

    /*
     * 辞退するとその招待は二度と開けなくなるので、同じ画面に戻すと 404 になってしまう。
     * 操作は成功しているのに失敗したように見えるため、ダッシュボード（"/"）へ送る。
     */
    return redirect("/");
  }

  return { formError: "不正な操作です。" } satisfies InvitationActionData;
}

/**
 * 招待の承諾画面（SCR-016）。
 */
export default function AcceptInvitationRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { invitation } = loaderData;

  return (
    <InvitationResponseCard
      title="団体への招待"
      description="以下の団体からメンバーとしての招待が届いています。内容を確認し、承諾または辞退を選択してください。"
      formError={actionData?.formError}
      acceptLabel="承諾して参加する"
      rejectDescription="この招待は使えなくなり、あとから承諾することはできません。参加する場合は、団体の管理者に招待し直してもらってください。"
    >
      <InvitationDetail label="招待元の団体">
        <p className="mt-1 text-lg font-semibold text-foreground">{invitation.groupName}</p>
      </InvitationDetail>

      <InvitationDetail label="割り当てられる役割">
        <div className="mt-1">
          <MembershipRoleBadge role={invitation.role} />
        </div>
      </InvitationDetail>

      <InvitationDetail label="承諾の有効期限">
        <p className="mt-1 text-sm text-foreground">
          {formatDateTime(new Date(invitation.expiresAt))}
        </p>
      </InvitationDetail>
    </InvitationResponseCard>
  );
}

/**
 * 招待の承諾画面のエラー表示。
 *
 * COND-011（存在の秘匿）に基づき、「存在しない」「期限切れ」「取り消し済み」「宛先違い」を区別せず
 * すべて同じ文言で案内する。理由を分けると、招待 ID を総当たりして特定の招待の実在を推測できてしまうため。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <InvitationErrorCard error={error} />;
}
