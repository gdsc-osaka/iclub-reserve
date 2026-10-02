import { CircleAlert, Clock, Mail, Trash2 } from "lucide-react";

import { MembershipRoleBadge } from "~/components/group/membership-role-badge";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import type { GroupInvitationList } from "~/query/group/group-invitation-list";
import { InvitationCancelDialog } from "./invitation-cancel-dialog";
import { formatRemainingTime } from "./invitation-expiry";
import { InvitationForm, type GroupInviteFormState } from "./invitation-form";

/**
 * 承諾待ちの招待一覧を表示するカード。
 *
 * 管理者および事務局スタッフのみに表示される。
 * 新規メンバーの招待フォームと、承諾待ちの招待一覧（取り消し操作を含む）を提供する。
 *
 * inviteForm と error は表示有無を明示するため省略可能（?）にせず、
 * 非表示時は null を渡すよう型で強制している。
 */
export function GroupInvitationCard({
  invitations,
  now,
  inviteForm,
  error,
}: Readonly<{
  invitations: GroupInvitationList;
  now: Date;
  inviteForm: GroupInviteFormState | null;
  error: string | null;
}>) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>承諾待ちの招待（{invitations.length} 件）</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 操作失敗時の全体エラー表示（取り消し失敗など） */}
        {error !== null && (
          <Alert variant="destructive">
            <CircleAlert className="size-4" />
            <AlertTitle>操作できませんでした</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 招待作成フォーム */}
        <InvitationForm state={inviteForm} />

        <Separator />

        {/* 招待一覧 */}
        {invitations.length === 0 ? (
          /* 空状態の案内 */
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Mail className="size-8 text-muted-foreground/60" aria-hidden />
            <p className="mt-2 text-sm font-medium text-foreground">承諾待ちの招待はありません</p>
            <p className="mt-1 text-xs text-muted-foreground">
              新しいメンバーを招待すると、ここに承諾待ちとして表示されます。
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex min-h-11 flex-col justify-center gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate text-sm font-medium text-foreground">
                    {invitation.email}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <MembershipRoleBadge role={invitation.role} />
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3.5 shrink-0" aria-hidden />
                    {formatRemainingTime(invitation.expiresAt, now)}
                  </span>
                  <InvitationCancelDialog
                    invitationId={invitation.id}
                    email={invitation.email}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 text-muted-foreground hover:text-destructive"
                        aria-label={`${invitation.email} への招待を取り消す`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
