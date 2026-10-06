import { useEffect, useRef, useState, type ReactNode } from "react";
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

interface StaffRevokeDialogProps {
  readonly targetUserId: string;
  readonly targetName: string;
  readonly isCurrentUser: boolean;
  readonly trigger: ReactNode;
}

/**
 * 事務局権限剥奪の確認ダイアログ。
 *
 * 事務局権限の剥奪は強い影響を持つため、確認ダイアログを挟む。
 * 本人への通知は送られないこと、および自分自身を剥奪する場合は
 * 事務局画面を開けなくなることを案内する。
 */
export function StaffRevokeDialog({
  targetUserId,
  targetName,
  isCurrentUser,
  trigger,
}: Readonly<StaffRevokeDialogProps>) {
  const [open, setOpen] = useState(false);
  const navigation = useNavigation();

  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "revoke-staff" &&
    navigation.formData?.get("user_id") === targetUserId;

  const hasSubmittedRef = useRef(false);
  useEffect(() => {
    if (isSubmitting) {
      hasSubmittedRef.current = true;
      return;
    }

    if (hasSubmittedRef.current) {
      hasSubmittedRef.current = false;
      setOpen(false);
    }
  }, [isSubmitting]);

  return (
    <>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
        <AlertDialogContent className="max-w-md">
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="revoke-staff" />
            <input type="hidden" name="user_id" value={targetUserId} />

            <AlertDialogHeader>
              <AlertDialogTitle>
                {isCurrentUser ? "自分の事務局権限を剥奪しますか？" : "事務局権限を剥奪しますか？"}
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2 text-left">
                <span>{targetName} の事務局権限を剥奪します。本人への通知は送られません。</span>
                {isCurrentUser && (
                  <span className="block text-destructive font-medium">
                    剥奪後は、この画面を含む事務局の画面を開けなくなります。
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel type="button" disabled={isSubmitting}>
                やめる
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={isSubmitting}>
                {isSubmitting ? "処理中…" : "剥奪する"}
              </Button>
            </AlertDialogFooter>
          </Form>
        </AlertDialogContent>
      </AlertDialog>

      {/* JavaScript が無効な環境向けのフォールバック */}
      <noscript>
        <Form method="post" className="inline-flex items-center gap-2">
          <input type="hidden" name="intent" value="revoke-staff" />
          <input type="hidden" name="user_id" value={targetUserId} />
          <Button type="submit" variant="destructive" size="sm" className="text-xs">
            剥奪する
          </Button>
        </Form>
      </noscript>
    </>
  );
}
