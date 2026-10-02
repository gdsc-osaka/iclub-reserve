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
 * 招待取り消し確認ダイアログ。
 *
 * 招待の取り消しは元に戻せない操作であるため、確認ダイアログを挟む。
 *
 * 送信後にダイアログを自分で閉じる処理（useEffect + hasSubmittedRef）を持つ。
 * これにより、万一サーバー側で処理に失敗した際にもダイアログが閉じ、
 * 背後のカードに表示されるエラー Alert が隠れずに確認できるようになる。
 *
 * JavaScript が無効な環境でも通常のフォーム送信で動作するよう、<noscript> フォールバックを備える。
 */
export function InvitationCancelDialog({
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

  // 同じ画面に他の招待行の取り消しボタンが並ぶため、
  // intent だけでなく invitation_id まで見て、押したボタンだけを「処理中」にする
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "cancel-invitation" &&
    navigation.formData?.get("invitation_id") === invitationId;

  /*
   * 送信が終わったら、このダイアログを自分で閉じる。
   * 開閉は open の state だけで決まるため、閉じる処理を書かないと送信後も開いたままになる。
   * 失敗したときは背後のカードに出したエラーがダイアログに隠れて読めなくなるのを防ぐため、
   * 送信完了時に必ず閉じるようにする。
   */
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
            <input type="hidden" name="intent" value="cancel-invitation" />
            <input type="hidden" name="invitation_id" value={invitationId} />

            <AlertDialogHeader>
              <AlertDialogTitle>招待を取り消しますか？</AlertDialogTitle>
              <AlertDialogDescription>
                {`${email} への招待を取り消します。この招待のリンクは使えなくなります。改めて招待し直すことはできます。`}
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
          <input type="hidden" name="intent" value="cancel-invitation" />
          <input type="hidden" name="invitation_id" value={invitationId} />
          <Button type="submit" variant="destructive" size="sm" className="text-xs">
            取り消す
          </Button>
        </Form>
      </noscript>
    </>
  );
}
