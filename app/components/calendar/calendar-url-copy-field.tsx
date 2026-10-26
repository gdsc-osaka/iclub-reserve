import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

export interface CalendarUrlCopyFieldProps {
  /** 入力欄と Label を紐づける ID */
  readonly id: string;
  /** 入力欄の上に表示するラベル */
  readonly label: string;
  /** 表示およびコピー対象の URL */
  readonly url: string;
  /** 読み上げる名前。同じ画面に欄が並ぶときに見分けられるよう付ける（省略時は label） */
  readonly ariaLabel?: string;
}

/**
 * カレンダー購読 URL の表示欄とコピーボタンを提供する共通コンポーネント。
 *
 * 施設のカレンダー購読カードと自団体の予約カレンダー購読カードの両方で使用する。
 * スマホ幅（375px）で横にはみ出さないよう、flex-col sm:flex-row かつ min-w-0 で構成する。
 */
export function CalendarUrlCopyField({ id, label, url, ariaLabel }: CalendarUrlCopyFieldProps) {
  const [copied, setCopied] = useState(false);
  /*
   * 「コピー完了」を元に戻すタイマー。
   * 2 秒以内にもう一度押されたら前のタイマーを止め、最後に押してから 2 秒は表示を残す。
   * 画面を離れたときにも止める。
   */
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
    },
    [],
  );

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("iCal URL をクリップボードにコピーしました。");

      if (copiedTimerRef.current !== null) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("URL のコピーに失敗しました。入力欄の文字を選択して手動でコピーしてください。");
    }
  };

  return (
    <div className="space-y-1.5 w-full min-w-0">
      <Label htmlFor={id} className="text-xs text-muted-foreground font-medium">
        {label}
      </Label>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full min-w-0">
        <Input
          id={id}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs w-full min-w-0 truncate"
          aria-label={ariaLabel ?? label}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleCopy}
          className="shrink-0 w-full sm:w-auto"
        >
          {copied ? (
            <>
              <Check className="size-4 mr-1.5 text-green-600" />
              コピー完了
            </>
          ) : (
            <>
              <Copy className="size-4 mr-1.5" />
              コピー
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
