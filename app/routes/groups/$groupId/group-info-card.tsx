import { CalendarPlus, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { Group } from "~/domain/group";
import { formatDateTime } from "~/lib/date";

/**
 * 団体 1 件の登録情報を並べるカード。
 *
 * 利用者にとって意味を持たない団体 ID は非表示とし、
 * 団体の状態はページ上部の見出しバッジで表示するため、
 * ここでは登録日時・最終更新日時の 2 項目を表示する。
 */
export function GroupInfoCard({ group }: Readonly<{ group: Group }>) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle className="text-xl">団体情報</CardTitle>
      </CardHeader>

      <CardContent>
        {/* 項目名と値の組み合わせなので、見出し付きのリスト（dl）で表す */}
        <dl className="grid gap-5 sm:grid-cols-2">
          <InfoItem icon={CalendarPlus} label="登録日時">
            {formatDateTime(group.createdAt)}
          </InfoItem>

          <InfoItem icon={RefreshCw} label="最終更新日時">
            {formatDateTime(group.updatedAt)}
          </InfoItem>
        </dl>
      </CardContent>
    </Card>
  );
}

/** 「項目名 + 値」を 1 組だけ表示する。カード内の各情報はすべてこの形にそろえている。 */
function InfoItem({
  icon: Icon,
  label,
  children,
}: Readonly<{
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}>) {
  return (
    <div className="space-y-1">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
        {label}
      </dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}
