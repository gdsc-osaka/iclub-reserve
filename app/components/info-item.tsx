import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * 「アイコン付きの項目名 + 値」を 1 組だけ表示する。見出し付きのリスト（`<dl>`）の中に置く。
 *
 * 団体管理（SCR-007）と予約詳細（SCR-005）で、カード内の情報をこの形にそろえている。
 * アイコンは飾りなので読み上げない（項目名が同じことを言っている）。
 */
export function InfoItem({
  icon: Icon,
  label,
  className,
  children,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  className?: string;
  children: ReactNode;
}>) {
  return (
    <div className={cn("space-y-1", className)}>
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}
