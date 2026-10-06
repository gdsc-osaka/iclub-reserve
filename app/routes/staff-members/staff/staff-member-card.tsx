import { CircleAlert, ShieldCheck } from "lucide-react";

import { toAvatarInitial } from "~/components/layout/shell-user";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { StaffMemberView } from "~/query/staff/staff-management";
import { StaffRevokeDialog } from "./staff-revoke-dialog";

/**
 * 事務局スタッフ一覧を表示するカード。
 *
 * 事務局スタッフの一覧（氏名・メールアドレス）を表示し、
 * 各行から事務局権限の剥奪（確認ダイアログ付き）を行える。
 * 操作者本人には「あなた」のバッジを表示する。
 */
export function StaffMemberCard({
  members,
  currentUserId,
  error,
}: Readonly<{
  members: readonly StaffMemberView[];
  currentUserId: string;
  error: string | null;
}>) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" />
          <span>事務局スタッフ</span>
        </CardTitle>
        <CardAction>
          <Badge variant="secondary">{members.length}人</Badge>
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
          {members.map((member) => {
            const isCurrentUser = member.userId === currentUserId;

            return (
              <li
                key={member.userId}
                className="flex min-h-11 items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback>{toAvatarInitial(member.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium leading-none truncate">
                        {member.name}
                      </span>
                      {isCurrentUser && (
                        <Badge variant="outline" className="text-xs">
                          あなた
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-1">{member.email}</p>
                  </div>
                </div>

                <div className="shrink-0">
                  <StaffRevokeDialog
                    targetUserId={member.userId}
                    targetName={member.name}
                    isCurrentUser={isCurrentUser}
                    trigger={
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`${member.name} の事務局権限を剥奪`}
                      >
                        剥奪
                      </Button>
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
