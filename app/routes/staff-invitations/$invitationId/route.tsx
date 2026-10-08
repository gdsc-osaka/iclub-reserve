import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import { InvitationDetail } from "~/components/invitation/invitation-detail";
import { InvitationErrorCard } from "~/components/invitation/invitation-error-card";
import {
  InvitationIntent,
  type InvitationActionData,
} from "~/components/invitation/invitation-intent";
import { InvitationResponseCard } from "~/components/invitation/invitation-response-card";
import { createDb } from "~/infra/db";
import { createStaffInvitationRepository } from "~/infra/staff/staff-invitation-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { formatDateTime } from "~/lib/date";
import {
  staffInvitationActionErrors,
  staffInvitationErrorResponse,
} from "~/routes/_shared/staff-error.server";
import { acceptStaffInvitationUseCase } from "~/usecases/staff/accept-staff-invitation";
import { getStaffInvitationUseCase } from "~/usecases/staff/get-staff-invitation";
import { rejectStaffInvitationUseCase } from "~/usecases/staff/reject-staff-invitation";

import type { Route } from "./+types/route";

export function meta(): Route.MetaDescriptors {
  return [{ title: "事務局への招待 | iclub-reserve" }];
}

/**
 * 事務局招待の承諾画面（SCR-020）のローダー。
 *
 * 事務局招待メールのリンクから開いたユーザーに対して、事務局になるとできることと有効期限を表示する。
 * 宛先が一致しない場合や期限切れ・取り消し済みの場合は、存在秘匿のため 404 を返す（COND-015）。
 * ユースケースは宛先違いを `InvitationNotVisible` として正直に返し、404 に揃えるのは表の側である（ADR-004 決定 4）。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  // この画面はログイン必須（root.tsx のミドルウェアが先に確認している）
  const user = requireRequestUser(context);
  const db = createDb(env.DB);
  const now = new Date();

  const result = await getStaffInvitationUseCase(
    {
      staffInvitationRepository: createStaffInvitationRepository(db),
    },
    {
      invitationId: params.invitationId,
      actorEmail: user.email,
      now,
    },
  );

  if (result.isErr()) {
    // 存在しない・期限切れ・取り消し済み・宛先違いは、すべて同じ 404 になる（COND-015）
    throw staffInvitationErrorResponse(
      { where: "staff-invitations.accept.loader", userId: user.id },
      result.error,
    );
  }

  return { invitation: result.value };
}

/**
 * 事務局招待の承諾画面のアクション。
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
    const result = await acceptStaffInvitationUseCase(
      {
        staffInvitationRepository: createStaffInvitationRepository(db),
      },
      {
        invitationId: params.invitationId,
        actorUserId: user.id,
        actorEmail: user.email,
        actorIsStaff: user.is_staff,
        now,
      },
    );

    if (result.isErr()) {
      /*
       * 「見つからない」は GET と同じ応答（404）を投げる（COND-015 存在の秘匿）。
       * ローダーが 404 を返す状況で action だけ 200 を返すと、
       * 応答ステータスの違いから招待の有無を外部から推測できてしまうため。
       */
      return staffInvitationActionErrors(
        { where: "staff-invitations.accept.action", userId: user.id },
        result.error,
      ) satisfies InvitationActionData;
    }

    // 承諾成功時は事務局一覧へ案内する（一覧に自分が並ぶので事務局になったことが分かる）
    return redirect("/staff/staff-members");
  }

  // 2. 辞退
  if (intent === InvitationIntent.Reject) {
    const result = await rejectStaffInvitationUseCase(
      {
        staffInvitationRepository: createStaffInvitationRepository(db),
      },
      {
        invitationId: params.invitationId,
        actorUserId: user.id,
        actorEmail: user.email,
        now,
      },
    );

    if (result.isErr()) {
      // 承諾と同じく、「見つからない」は 404 を投げる
      return staffInvitationActionErrors(
        { where: "staff-invitations.reject.action", userId: user.id },
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
 * 事務局招待の承諾画面（SCR-020）。
 */
export default function AcceptStaffInvitationRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { invitation } = loaderData;

  return (
    <InvitationResponseCard
      title="事務局への招待"
      description="事務局への招待が届いています。内容を確認し、承諾または辞退を選択してください。"
      formError={actionData?.formError}
      acceptLabel="承諾して事務局になる"
      rejectDescription="この招待は使えなくなり、あとから承諾することはできません。事務局になる場合は、事務局に招待し直してもらってください。"
    >
      <InvitationDetail label="事務局になるとできること">
        <p className="mt-1 text-sm text-foreground">
          所属に関わらず、すべての団体・すべての予約を確認・操作できるようになります。
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>仮予約の承認・却下</li>
          <li>予約の直接作成・変更・キャンセル</li>
          <li>団体の有効化・無効化</li>
          <li>施設・設備の管理</li>
          <li>操作履歴の閲覧</li>
          <li>事務局の招待・剥奪</li>
        </ul>
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
 * 事務局招待の承諾画面のエラー表示。
 *
 * COND-015（存在の秘匿）に基づき、「存在しない」「期限切れ」「取り消し済み」「宛先違い」を区別せず
 * すべて同じ文言で案内する。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <InvitationErrorCard error={error} />;
}
