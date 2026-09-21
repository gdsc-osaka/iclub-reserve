import { MembershipRoleBadge } from "~/components/group/membership-role-badge";
import { toAvatarInitial } from "~/components/layout/shell-user";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { MembershipRole } from "~/domain/membership";
import type { GroupManagementView } from "~/usecases/group/get-group-management";

/**
 * 団体の所属メンバー一覧を表示するカード。
 *
 * メールアドレスを出してよいかどうかは、判別可能なユニオン（GroupManagementView）の
 * `canManage` を見ないと分からない。props を緩い型に詰め替えずにユニオンのまま受け取り、
 * ここで一度だけ分岐することで、権限が無い経路から email に触れると
 * 型エラーになる状態を保っている。
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
      <CardHeader>
        <CardTitle>メンバー</CardTitle>
        <CardAction>
          <Badge variant="secondary">{view.members.length}人</Badge>
        </CardAction>
      </CardHeader>

      <CardContent>
        <ul className="divide-y divide-border">
          {view.canManage
            ? view.members.map((member) => (
                <MemberRow
                  key={member.memberId}
                  name={member.name}
                  email={member.email}
                  roles={member.roles}
                  isCurrentUser={member.userId === currentUserId}
                />
              ))
            : view.members.map((member) => (
                <MemberRow
                  key={member.memberId}
                  name={member.name}
                  email={null}
                  roles={member.roles}
                  isCurrentUser={member.userId === currentUserId}
                />
              ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * メンバー 1 人分の行。
 *
 * `email` を省略可能（`email?: string`）にせず、出さないときは null を明示的に渡させている。
 * 省略できるようにすると、渡し忘れたときに型エラーにならず
 * 「たまたま表示されない」状態が見過ごされてしまう。
 */
function MemberRow({
  name,
  email,
  roles,
  isCurrentUser,
}: Readonly<{
  name: string;
  email: string | null;
  roles: readonly MembershipRole[];
  isCurrentUser: boolean;
}>) {
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-9 shrink-0">
          <AvatarFallback>{toAvatarInitial(name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            {isCurrentUser && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                あなた
              </span>
            )}
          </div>

          {email !== null && <p className="truncate text-xs text-muted-foreground">{email}</p>}
        </div>
      </div>

      <div className="shrink-0">
        <MembershipRoleBadge roles={roles} />
      </div>
    </li>
  );
}
