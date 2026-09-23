import { env } from "cloudflare:workers";
import { Form, isRouteErrorResponse, Link, redirect, useNavigation } from "react-router";

import { MembershipRoleBadge } from "~/components/group/membership-role-badge";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
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
import { InvitationRejectDialog } from "./invitation-reject-dialog";

/** この画面には入力欄が無いので、誤りはすべてフォームの上に出す */
export interface InvitationActionData {
  readonly formError: string | null;
}

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
  if (intent === "accept") {
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
  if (intent === "reject") {
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
  const navigation = useNavigation();
  const isAccepting =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "accept";

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-10 md:py-16">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            団体への招待
          </CardTitle>
          <CardDescription>
            以下の団体からメンバーとしての招待が届いています。内容を確認し、承諾または辞退を選択してください。
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {actionData?.formError && (
            <Alert variant="destructive">
              <AlertTitle>エラー</AlertTitle>
              <AlertDescription>{actionData.formError}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">招待元の団体</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{invitation.groupName}</p>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">割り当てられる役割</p>
              <div className="mt-1">
                <MembershipRoleBadge role={invitation.role} />
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">承諾の有効期限</p>
              <p className="mt-1 text-sm text-foreground">
                {formatDateTime(new Date(invitation.expiresAt))}
              </p>
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <InvitationRejectDialog
            trigger={
              <Button type="button" variant="outline" className="w-full sm:w-auto">
                辞退する
              </Button>
            }
          />

          <Form method="post" className="w-full sm:w-auto">
            <input type="hidden" name="intent" value="accept" />
            <Button type="submit" disabled={isAccepting} className="w-full sm:w-auto">
              {isAccepting ? "処理中…" : "承諾して参加する"}
            </Button>
          </Form>
        </CardFooter>
      </Card>
    </main>
  );
}

/**
 * 招待の承諾画面のエラー表示。
 *
 * COND-011（存在の秘匿）に基づき、「存在しない」「期限切れ」「取り消し済み」「宛先違い」を区別せず
 * すべて同じ文言で案内する。理由を分けると、招待 ID を総当たりして特定の招待の実在を推測できてしまうため。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isNotFound ? "招待が見つかりません" : "招待を表示できません"}
          </CardTitle>
          <CardDescription>
            {isNotFound
              ? "この招待は期限切れ・取り消し済みか、別のメールアドレス宛ての可能性があります。招待メールの宛先と同じメールアドレスでログインしているか、ご確認ください。"
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
