import { useEffect, useRef, useState } from "react";
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
import { GroupStatus } from "~/domain/group";
import type { GroupStatusChangeTarget } from "~/domain/group/status-transition";

/** 変更先ごとに、ボタンとダイアログに出す文言と見た目 */
interface GroupStatusDialogConfig {
  /** 一覧の行に出すボタンの名前 */
  readonly triggerLabel: string;
  readonly triggerVariant: "default" | "outline";
  readonly title: (groupName: string) => string;
  readonly description: string;
  /** ダイアログの中の実行ボタンの名前 */
  readonly actionLabel: string;
  readonly actionVariant: "default" | "destructive";
}

/**
 * 変更先ごとの文言。
 *
 * 有効化も確認を挟む。承認待ちの団体を有効にすると、その団体のメンバーが
 * すぐに予約を申請できるようになるので、押し間違えたまま気付かないと困るため。
 */
const dialogConfigs: Record<GroupStatusChangeTarget, GroupStatusDialogConfig> = {
  [GroupStatus.Enabled]: {
    triggerLabel: "有効化",
    triggerVariant: "default",
    title: (groupName) => `${groupName} を有効にしますか？`,
    description: "有効にすると、この団体のメンバーが再び予約を申請できるようになります。",
    actionLabel: "有効化する",
    actionVariant: "default",
  },
  [GroupStatus.Disabled]: {
    triggerLabel: "無効化",
    triggerVariant: "outline",
    title: (groupName) => `${groupName} を無効にしますか？`,
    description:
      "無効にすると、この団体では予約を申請できなくなります。すでにある予約はそのまま残ります。",
    actionLabel: "無効化する",
    actionVariant: "destructive",
  },
};

/**
 * 承認待ちの団体を有効にするときの文言。
 *
 * 利用者には、登録した団体は「事務局の承認」を待つと案内している。
 * 同じ操作を事務局の側だけ「有効化」と呼ぶと、話が通じなくなるため、ここだけ「承認」と呼ぶ。
 */
const approveDialogConfig: GroupStatusDialogConfig = {
  triggerLabel: "承認",
  triggerVariant: "default",
  title: (groupName) => `${groupName} を承認しますか？`,
  description: "承認すると、この団体のメンバーが予約を申請できるようになります。",
  actionLabel: "承認する",
  actionVariant: "default",
};

/**
 * 団体の有効化・無効化のボタンと、確認のダイアログ（UC-014）。
 *
 * `<Form method="post">` による通常のフォーム送信で構成し、JavaScript が無効でも動作する。
 */
export function GroupStatusDialog({
  groupId,
  groupName,
  currentStatus,
  status,
}: Readonly<{
  groupId: string;
  groupName: string;
  /** いまの状態。承認待ちから有効にするときだけ、文言を「承認」にする */
  currentStatus: GroupStatus;
  /** 変更先の状態 */
  status: GroupStatusChangeTarget;
}>) {
  const [open, setOpen] = useState(false);
  const navigation = useNavigation();

  const config =
    currentStatus === GroupStatus.Pending && status === GroupStatus.Enabled
      ? approveDialogConfig
      : dialogConfigs[status];

  // この団体のこの操作が送信中か。同じ画面に他の団体のボタンが並ぶので、
  // 団体 ID と変更先まで見て、押したボタンだけを「処理中」にする
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "change-status" &&
    navigation.formData.get("groupId") === groupId &&
    navigation.formData.get("status") === status;

  /*
   * 送信が終わったら、このダイアログを自分で閉じる（member-action-dialog.tsx と同じ）。
   *
   * 開閉は open の state だけで決まるので、閉じる処理を書かないと送信後も開いたままになる。
   * 失敗したとき（別の事務局が先に変えていた、など）は団体が一覧に残るため、
   * ダイアログが開いたままだと、結果の通知が背後に隠れて読めなくなる。
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
        <AlertDialogTrigger asChild>
          <Button variant={config.triggerVariant} size="sm">
            {config.triggerLabel}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="change-status" />
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="status" value={status} />

            <AlertDialogHeader>
              <AlertDialogTitle>{config.title(groupName)}</AlertDialogTitle>
              <AlertDialogDescription>{config.description}</AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
              <AlertDialogCancel type="button" disabled={isSubmitting}>
                やめる
              </AlertDialogCancel>
              <Button type="submit" variant={config.actionVariant} disabled={isSubmitting}>
                {isSubmitting ? "処理中…" : config.actionLabel}
              </Button>
            </AlertDialogFooter>
          </Form>
        </AlertDialogContent>
      </AlertDialog>

      {/* JavaScript が無効な環境向けのフォールバック（確認を挟まず、通常のフォーム送信で成立させる） */}
      <noscript>
        <Form method="post">
          <input type="hidden" name="intent" value="change-status" />
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="status" value={status} />
          <Button type="submit" variant={config.triggerVariant} size="sm">
            {config.triggerLabel}
          </Button>
        </Form>
      </noscript>
    </>
  );
}
