import { useState, type ReactNode } from "react";
import { Form, useNavigation } from "react-router";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

/** メンバー 1 人に対してできる操作 */
export const MemberAction = {
  Promote: "promote",
  Demote: "demote",
  Remove: "remove",
} as const;
export type MemberAction = (typeof MemberAction)[keyof typeof MemberAction];

interface MemberActionDialogProps {
  readonly action: MemberAction;
  readonly targetUserId: string;
  readonly targetName: string;
  readonly isCurrentUser: boolean;
  readonly trigger: ReactNode;
}

interface DialogConfig {
  readonly intent: "update-member-role" | "remove-member";
  readonly role?: "admin" | "member";
  readonly title: string;
  readonly actionLabel: string;
  readonly actionVariant: "default" | "destructive";
  readonly description: string;
  readonly currentUserNotice: string | null;
}

const getDialogConfig = (
  action: MemberAction,
  targetName: string,
  isCurrentUser: boolean,
): DialogConfig => {
  switch (action) {
    case MemberAction.Promote:
      return {
        intent: "update-member-role",
        role: "admin",
        title: "管理者にしますか？",
        actionLabel: "管理者にする",
        actionVariant: "default",
        description: `${targetName} を管理者にします。管理者はメンバーの招待・削除や団体情報の編集など、団体のすべての管理を行えるようになります。`,
        currentUserNotice: null,
      };
    case MemberAction.Demote:
      return {
        intent: "update-member-role",
        role: "member",
        title: "メンバーに戻しますか？",
        actionLabel: "メンバーにする",
        actionVariant: "default",
        description: `${targetName} を一般メンバーに変更します。`,
        currentUserNotice: isCurrentUser
          ? "この操作のあと、あなたはこの画面を編集できなくなります。"
          : null,
      };
    case MemberAction.Remove:
      return {
        intent: "remove-member",
        title: "団体から削除しますか？",
        actionLabel: "削除する",
        actionVariant: "destructive",
        description: `${targetName} を団体から削除します。この操作は取り消せません。再び団体に参加してもらうには、改めて招待を送る必要があります。`,
        currentUserNotice: isCurrentUser ? "この操作のあと、あなたはこの団体から外れます。" : null,
      };
  }
};

/**
 * メンバー操作（昇格・降格・削除）の確認ダイアログ。
 *
 * 役割変更や削除は重大な権限変動を伴い、自分を降格・削除した場合は自力で復旧できないため、
 * すべての操作で対象の名前を明示した確認ダイアログを挟む。
 *
 * `<Form method="post">` による標準のフォーム送信で構成し、JavaScript が無効でも動作する。
 */
export function MemberActionDialog({
  action,
  targetUserId,
  targetName,
  isCurrentUser,
  trigger,
}: Readonly<MemberActionDialogProps>) {
  const [open, setOpen] = useState(false);
  const navigation = useNavigation();

  const config = getDialogConfig(action, targetName, isCurrentUser);

  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === config.intent &&
    navigation.formData?.get("user_id") === targetUserId;

  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
        <AlertDialogContent className="max-w-md">
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value={config.intent} />
            <input type="hidden" name="user_id" value={targetUserId} />
            {config.role !== undefined && <input type="hidden" name="role" value={config.role} />}

            <AlertDialogHeader>
              <AlertDialogTitle>{config.title}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>{config.description}</p>
                  {config.currentUserNotice !== null && (
                    <p className="font-semibold text-destructive">{config.currentUserNotice}</p>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel type="button" disabled={isSubmitting}>
                キャンセル
              </AlertDialogCancel>
              <Button type="submit" variant={config.actionVariant} disabled={isSubmitting}>
                {isSubmitting ? "処理中…" : config.actionLabel}
              </Button>
            </AlertDialogFooter>
          </Form>
        </AlertDialogContent>
      </AlertDialog>

      {/* JavaScript が無効な環境向けのフォールバック（通常のフォーム送信で成立させる） */}
      <noscript>
        <Form method="post" className="inline-flex items-center gap-2">
          <input type="hidden" name="intent" value={config.intent} />
          <input type="hidden" name="user_id" value={targetUserId} />
          {config.role !== undefined && <input type="hidden" name="role" value={config.role} />}
          <Button type="submit" variant={config.actionVariant} size="sm" className="text-xs">
            {config.actionLabel}
          </Button>
        </Form>
      </noscript>
    </>
  );
}
