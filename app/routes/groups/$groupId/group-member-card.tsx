import { MembershipRoleBadge } from "~/components/group/membership-role-badge";
import { toAvatarInitial } from "~/components/layout/shell-user";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { GroupManagementView } from "~/usecases/group/get-group-management";

/**
 * 団体の所属メンバー一覧を表示するカード。
 *
 * 閲覧者の管理権限（view.canManage）によって、メールアドレスの表示有無を制御する。
 * 型安全性を保証するため、props は判別可能なユニオン（GroupManagementView）のまま受け取り、
 * コンポーネント内で view.canManage を確認して安全に分岐する。
 */
export function GroupMemberCard({
  view,
  currentUserId,
}: Readonly<{
  view: GroupManagementView;
  currentUserId: string;
}>) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xl">メンバー</CardTitle>
        <Badge variant="secondary">{view.members.length}人</Badge>
      </CardHeader>

      <CardContent>
        {view.canManage ? (
          /* 管理者・事務局向けの表示: メールアドレスを表示する */
          <ul className="divide-y divide-border">
            {view.members.map((member) => (
              <li
                key={member.memberId}
                className="flex min-h-[44px] items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback>{toAvatarInitial(member.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {member.name}
                      </span>
                      {member.userId === currentUserId && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          あなた
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                  </div>
                </div>
                <div className="shrink-0">
                  <MembershipRoleBadge roles={member.roles} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          /* 一般メンバー向けの表示: メールアドレスは型・表示ともに存在しない */
          <ul className="divide-y divide-border">
            {view.members.map((member) => (
              <li
                key={member.memberId}
                className="flex min-h-[44px] items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback>{toAvatarInitial(member.name)}</AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {member.name}
                    </span>
                    {member.userId === currentUserId && (
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        あなた
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  <MembershipRoleBadge roles={member.roles} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
