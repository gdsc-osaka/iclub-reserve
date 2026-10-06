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

/**
 * 事務局招待取り消し確認ダイアログ。
 *
 * 招待の取り消しは元に戻せない操作であるため、確認ダイアログを挟む。
 * 送信完了時に自動的にダイアログを閉じる。
 */
export function StaffInvitationCancelDialog({
  invitationId,
  email,
  trigger,
}: Readonly<{
  invitationId: string;
  email: string;
  trigger: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const navigation = useNavigation();

  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "cancel-staff-invitation" &&
    navigation.formData?.get("invitation_id") === invitationId;

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
            <input type="hidden" name="intent" value="cancel-staff-invitation" />
            <input type="hidden" name="invitation_id" value={invitationId} />

            <AlertDialogHeader>
              <AlertDialogTitle>招待を取り消しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                {`${email} への事務局招待を取り消します。この招待のリンクは使えなくなります。改めて招待し直すことはできます。`}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel type="button" disabled={isSubmitting}>
                やめる
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={isSubmitting}>
                {isSubmitting ? "処理中…" : "取り消す"}
              </Button>
            </AlertDialogFooter>
          </Form>
        </AlertDialogContent>
      </AlertDialog>

      {/* JavaScript が無効な環境向けのフォールバック */}
      <noscript>
        <Form method="post" className="inline-flex items-center gap-2">
          <input type="hidden" name="intent" value="cancel-staff-invitation" />
          <input type="hidden" name="invitation_id" value={invitationId} />
          <Button type="submit" variant="destructive" size="sm" className="text-xs">
            取り消す
          </Button>
        </Form>
      </noscript>
    </>
  );
}
