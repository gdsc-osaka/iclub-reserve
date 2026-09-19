import { CalendarPlus, Hash, RefreshCw, ToggleLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { GroupStatusBadge, groupStatusLabel } from "~/components/group/group-status-badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import type { Group } from "~/domain/group";
import { formatDateTime } from "~/lib/date";

/** グループ 1 件の登録情報を並べるカード。この画面の本体にあたる。 */
export function GroupInfoCard({ group }: Readonly<{ group: Group }>) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle className="text-xl">{group.name}</CardTitle>
        <CardDescription>グループの登録情報</CardDescription>
        <CardAction>
          <GroupStatusBadge status={group.status} />
        </CardAction>
      </CardHeader>

      <CardContent>
        {/* 項目名と値の組み合わせなので、見出し付きのリスト（dl）で表す */}
        <dl className="grid gap-5 sm:grid-cols-2">
          <InfoItem icon={Hash} label="グループ ID">
            <span className="font-mono break-all">{group.id}</span>
          </InfoItem>

          <InfoItem icon={ToggleLeft} label="状態">
            {groupStatusLabel[group.status]}
          </InfoItem>

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
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
