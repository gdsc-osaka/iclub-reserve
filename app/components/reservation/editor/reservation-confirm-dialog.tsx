import { CalendarCheck } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";

/**
 * 送信する前に、内容を確かめてもらうダイアログ。
 *
 * 申請すると、団体の管理者全員と事務局にメールが届く（EVT-001）。
 * 誤った申請は他の人の手間になるので、送る前に一度だけ立ち止まってもらう。
 * 何を並べるかは画面ごとに違う（申請なら内容の一覧、編集なら変更前と変更後）ので、
 * 中身は `children` で受け取り、ここは枠と送信のボタンだけを持つ。
 *
 * 入力欄はダイアログに入れず、フォームに残したままにする。
 * ダイアログはページの末尾（`body` の直下）に描かれ、フォームの外に出てしまうので、
 * 送信のボタンは `form` 属性でフォームを指して送る。
 */
export function ReservationConfirmDialog({
  open,
  onOpenChange,
  formId,
  isSubmitting,
  title,
  description,
  submitLabel,
  submittingLabel,
  children,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 送信するフォームの id */
  formId: string;
  /** このフォームを送信している最中か */
  isSubmitting: boolean;
  title: string;
  description: string;
  /** 送信のボタンの文言（例: 「この内容で申請する」） */
  submitLabel: string;
  /** 送信している間のボタンの文言（例: 「申請中…」） */
  submittingLabel: string;
  children: ReactNode;
}>) {
  /*
   * 送信が終わったら、このダイアログを自分で閉じる。
   *
   * 成功したときは画面ごと「申請しました」に変わるので気付きにくいが、
   * 失敗したときは開いたまま残り、欄の下に出した誤りがダイアログの背後に隠れて読めない。
   * 「送信中になった」ことを覚えておき、それが終わった瞬間に閉じる
   * （予約の操作ダイアログ `ReservationActionDialog` と同じやり方）。
   */
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    if (isSubmitting) {
      hasSubmittedRef.current = true;
      return;
    }

    if (hasSubmittedRef.current) {
      hasSubmittedRef.current = false;
      onOpenChange(false);
    }
  }, [isSubmitting, onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-4 text-sm">{children}</div>

        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={isSubmitting}>
            戻って直す
          </AlertDialogCancel>

          <Button type="submit" form={formId} disabled={isSubmitting}>
            <CalendarCheck aria-hidden />
            {isSubmitting ? submittingLabel : submitLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
