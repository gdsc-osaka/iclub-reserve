import { CalendarPlus, RefreshCw } from "lucide-react";

import { InfoItem } from "~/components/info-item";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import type { Group } from "~/domain/group";
import { formatDateTime } from "~/lib/date";

import { GroupNameForm, type GroupNameFormState } from "./group-name-form";

/**
 * 団体の基本情報と編集フォームをまとめたカード。
 *
 * 管理者および事務局スタッフには団体名のインライン編集フォームを表示し、
 * 一般メンバーには登録日時と最終更新日時のみの読み取り専用カードとして表示する。
 */
export function GroupInfoCard({
  group,
  canManage,
  nameForm,
}: Readonly<{
  group: Group;
  canManage: boolean;
  nameForm: GroupNameFormState | null;
}>) {
  return (
    <Card className="[--card-spacing:--spacing(6)]">
      <CardHeader>
        <CardTitle>団体情報</CardTitle>
        {canManage && (
          <CardDescription>団体名は予約の一覧や事務局への通知に表示されます。</CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-6">
        {canManage && (
          <>
            <GroupNameForm name={group.name} state={nameForm} />
            <Separator />
          </>
        )}

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
