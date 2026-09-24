import type { ReactNode } from "react";

/**
 * 確認欄の「項目名 + 値」を 1 組。まだ決まっていない項目はその旨を出す。
 *
 * `<dl>` の中に並べて使う。申請の確認ダイアログと、申請し終えたあとの控えで同じ見た目にしている。
 */
export function SummaryItem({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium break-words whitespace-pre-wrap">
        {children ?? <span className="font-normal text-muted-foreground">未入力</span>}
      </dd>
    </div>
  );
}
