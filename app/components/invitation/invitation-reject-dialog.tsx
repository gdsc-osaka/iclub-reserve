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
import { InvitationIntent } from "./invitation-intent";

/**
 * 招待辞退確認ダイアログ。
 *
 * 招待の辞退は元に戻せない操作（二度と承諾できなくなる）であるため、確認ダイアログを挟む。
 *
 * 送信後にダイアログを自分で閉じる処理（useEffect + hasSubmittedRef）を持つ。
 * これにより、万一サーバー側で処理に失敗した際にもダイアログが閉じ、
 * 背後のカードに表示されるエラー Alert が隠れずに確認できるようになる。
 *
 * JavaScript が無効な環境でも通常のフォーム送信で動作するよう、<noscript> フォールバックを備える。
 */
export function InvitationRejectDialog({
  trigger,
  description,
}: Readonly<{
  trigger: ReactNode;
  description: string;
}>) {
  const [open, setOpen] = useState(false);
  const navigation = useNavigation();

  // この画面には招待が 1 件しかないため、intent だけ見て「処理中」を判定する
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === InvitationIntent.Reject;

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
            <input type="hidden" name="intent" value={InvitationIntent.Reject} />

            <AlertDialogHeader>
              <AlertDialogTitle>招待を辞退しますか？</AlertDialogTitle>
              <AlertDialogDescription>{description}</AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter className="mt-2">
              <AlertDialogCancel type="button" disabled={isSubmitting}>
                やめる
              </AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={isSubmitting}>
                {isSubmitting ? "処理中…" : "辞退する"}
              </Button>
            </AlertDialogFooter>
          </Form>
        </AlertDialogContent>
      </AlertDialog>

      {/* JavaScript が無効な環境向けのフォールバック */}
      <noscript>
        <Form method="post" className="inline-flex items-center gap-2">
          <input type="hidden" name="intent" value={InvitationIntent.Reject} />
          <Button type="submit" variant="destructive" size="sm" className="text-xs">
            辞退する
          </Button>
        </Form>
      </noscript>
    </>
  );
}
