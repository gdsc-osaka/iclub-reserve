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

export type FacilityStatusChangeTarget = "active" | "inactive";

interface FacilityStatusDialogConfig {
  readonly triggerLabel: string;
  readonly triggerVariant: "default" | "outline";
  readonly title: (facilityName: string) => string;
  readonly description: string;
  readonly actionLabel: string;
  readonly actionVariant: "default" | "destructive";
}

const dialogConfigs: Record<FacilityStatusChangeTarget, FacilityStatusDialogConfig> = {
  active: {
    triggerLabel: "有効化",
    triggerVariant: "default",
    title: (name) => `${name} を有効にしますか？`,
    description: "有効にすると、利用者がこの施設・設備を予約できるようになります。",
    actionLabel: "有効化する",
    actionVariant: "default",
  },
  inactive: {
    triggerLabel: "無効化",
    triggerVariant: "outline",
    title: (name) => `${name} を無効にしますか？`,
    description:
      "無効にすると、利用者はこの施設・設備を新しく予約できなくなります。今後の予約（仮予約・開始前の承認済み予約）が残っている場合は無効化できません。",
    actionLabel: "無効化する",
    actionVariant: "destructive",
  },
};

/**
 * 施設の有効化・無効化のボタンと、確認のダイアログ（UC-016）。
 *
 * `<Form method="post">` による通常のフォーム送信で構成し、JavaScript が無効でも動作する。
 */
export function FacilityStatusDialog({
  facilityId,
  facilityName,
  targetStatus,
}: Readonly<{
  facilityId: string;
  facilityName: string;
  targetStatus: FacilityStatusChangeTarget;
}>) {
  const [open, setOpen] = useState(false);
  const navigation = useNavigation();

  const config = dialogConfigs[targetStatus];

  // この施設のこの操作が送信中かどうかを判定
  const isSubmitting =
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "change-status" &&
    navigation.formData.get("facilityId") === facilityId &&
    navigation.formData.get("status") === targetStatus;

  // 送信完了時に自動でダイアログを閉じる
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
        <AlertDialogContent className="max-w-md">
          <Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="change-status" />
            <input type="hidden" name="facilityId" value={facilityId} />
            <input type="hidden" name="status" value={targetStatus} />

            <AlertDialogHeader>
              <AlertDialogTitle>{config.title(facilityName)}</AlertDialogTitle>
              <AlertDialogDescription>{config.description}</AlertDialogDescription>
            </AlertDialogHeader>

            <AlertDialogFooter>
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

      {/* JavaScript が無効な環境向けのフォールバック */}
      <noscript>
        <Form method="post">
          <input type="hidden" name="intent" value="change-status" />
          <input type="hidden" name="facilityId" value={facilityId} />
          <input type="hidden" name="status" value={targetStatus} />
          <Button type="submit" variant={config.triggerVariant} size="sm">
            {config.triggerLabel}
          </Button>
        </Form>
      </noscript>
    </>
  );
}
