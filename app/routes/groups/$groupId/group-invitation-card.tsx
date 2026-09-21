import { Clock, Mail } from "lucide-react";

import { MembershipRoleBadge } from "~/components/group/membership-role-badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { GroupInvitationList } from "~/query/group/group-invitation-list";
import { formatRemainingTime } from "./invitation-expiry";

/**
 * 承諾待ちの招待一覧を表示するカード。
 *
 * 管理者および事務局スタッフのみに表示される。
 * 期限切れの招待はユースケース層で除外されており、ここでは有効な未承認の招待のみが並ぶ。
 */
export function GroupInvitationCard({
  invitations,
  now,
}: Readonly<{
  invitations: GroupInvitationList;
  now: Date;
}>) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle className="text-xl">承諾待ちの招待（{invitations.length} 件）</CardTitle>
      </CardHeader>

      <CardContent>
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
                className="flex min-h-[44px] flex-col justify-center gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate text-sm font-medium text-foreground">
                    {invitation.email}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  <MembershipRoleBadge roles={invitation.roles} />
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3.5 shrink-0" aria-hidden />
                    {formatRemainingTime(invitation.expiresAt, now)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
