import { CircleAlert, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { MembershipRoleBadge } from "~/components/group/membership-role-badge";
import { toAvatarInitial } from "~/components/layout/shell-user";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { MembershipRole } from "~/domain/membership";
import type { GroupManagementView } from "~/usecases/group/get-group-management";
import { MemberAction, MemberActionDialog } from "./member-action-dialog";

/**
 * 団体の所属メンバー一覧を表示するカード。
 *
 * メールアドレスやメンバー管理操作（昇格・降格・削除）を出してよいかどうかは、
 * 判別可能なユニオン（GroupManagementView）の `canManage` を見ないと分からない。
 * props を緩い型に詰め替えずにユニオンのまま受け取り、ここで一度だけ分岐することで、
 * 権限が無い経路から email や管理操作に触れると型エラーになる状態を保っている。
 */
export function GroupMemberCard({
  view,
  currentUserId,
  error,
}: Readonly<{
  view: GroupManagementView;
  currentUserId: string;
  error: string | null;
}>) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>メンバー</CardTitle>
        <CardAction>
          <Badge variant="secondary">{view.members.length}人</Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* 操作失敗時のエラー表示 */}
        {error !== null && (
          <Alert variant="destructive">
            <CircleAlert className="size-4" />
            <AlertTitle>操作できませんでした</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <ul className="divide-y divide-border">
          {view.canManage
            ? view.members.map((member) => {
                const isAdmin = member.role === MembershipRole.Admin;
                const isCurrentUser = member.userId === currentUserId;

                return (
                  <MemberRow
                    key={member.memberId}
                    name={member.name}
                    email={member.email}
                    role={member.role}
                    isCurrentUser={isCurrentUser}
                    action={
                      <div className="flex items-center gap-1">
                        {/* 役割切り替えボタン（管理者なら降格、一般メンバーなら昇格） */}
                        <MemberActionDialog
                          action={isAdmin ? MemberAction.Demote : MemberAction.Promote}
                          targetUserId={member.userId}
                          targetName={member.name}
                          isCurrentUser={isCurrentUser}
                          trigger={
                            <Button variant="outline" size="sm">
                              {isAdmin ? "メンバーにする" : "管理者にする"}
                            </Button>
                          }
                        />

                        {/* 削除ボタン（ゴミ箱アイコン） */}
                        <MemberActionDialog
                          action={MemberAction.Remove}
                          targetUserId={member.userId}
                          targetName={member.name}
                          isCurrentUser={isCurrentUser}
                          trigger={
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-11 text-muted-foreground hover:text-destructive"
                              aria-label={`${member.name} を団体から削除`}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          }
                        />
                      </div>
                    }
                  />
                );
              })
            : view.members.map((member) => (
                <MemberRow
                  key={member.memberId}
                  name={member.name}
                  email={null}
                  role={member.role}
                  isCurrentUser={member.userId === currentUserId}
                  action={null}
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
 * `email` や `action` を省略可能にせず、出さないときは null を明示的に渡させている。
 * 省略できるようにすると、渡し忘れたときに型エラーにならず
 * 「たまたま表示されない」状態が見過ごされてしまう。
 */
function MemberRow({
  name,
  email,
  role,
  isCurrentUser,
  action,
}: Readonly<{
  name: string;
  email: string | null;
  role: MembershipRole;
  isCurrentUser: boolean;
  action: ReactNode | null;
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

      <div className="flex shrink-0 items-center gap-2">
        <MembershipRoleBadge role={role} />
        {action}
      </div>
    </li>
  );
}
