import { CalendarDays, FilterX, Users } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  toReservationListPath,
  type ParsedReservationListParams,
} from "~/routes/reservations/list/query-params";

interface ReservationListEmptyProps {
  readonly noGroups: boolean;
  readonly isStaffProvisionalEmpty: boolean;
  readonly scope: "own" | "all";
  readonly params: ParsedReservationListParams;
}

/**
 * 予約一覧の空状態コンポーネント。
 *
 * 1. 所属団体が 0 件のとき: 理由を説明し空き状況カレンダーへの導線を残す
 * 2. 事務局の承認待ちが 0 件のとき: 待機中の申請がない旨を表示
 * 3. 絞り込みの結果が 0 件のとき: 条件に合う予約がない旨と、絞り込み解除リンクを表示
 */
export function ReservationListEmpty({
  noGroups,
  isStaffProvisionalEmpty,
  scope,
  params,
}: Readonly<ReservationListEmptyProps>) {
  // 1. 所属団体が 0 件の場合
  if (noGroups) {
    return (
      <Card className="border-dashed py-8 text-center">
        <CardHeader className="flex flex-col items-center gap-2 pb-2">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Users className="size-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-lg">まだどの団体にも所属していません</CardTitle>
          <CardDescription className="max-w-md">
            予約を申請するには、団体に参加するか新しい団体を作成して事務局の承認を受ける必要があります。
            空き状況の確認は所属がなくてもご利用いただけます。
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          <Button asChild>
            <Link to="/availability" className="inline-flex items-center gap-2">
              <CalendarDays className="size-4" />
              空き状況カレンダーを見る
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 2. 事務局の承認待ちが 0 件の場合
  if (isStaffProvisionalEmpty) {
    return (
      <Card className="border-dashed py-10 text-center">
        <CardContent className="flex flex-col items-center gap-2 py-4">
          <p className="text-base font-medium text-foreground">承認を待っている申請はありません</p>
          <p className="text-sm text-muted-foreground">
            現在、事務局による確認が必要な仮予約はすべて処理されています。
          </p>
        </CardContent>
      </Card>
    );
  }

  // 3. 絞り込み条件に一致する予約が 0 件の場合
  // 絞り込みを外すリンク: ステータスはデフォルト（own: all, staff: provisional）へ戻し、facilityとperiodをリセット
  const resetPath = toReservationListPath(
    {
      group: params.group,
      status: scope === "all" ? "provisional" : "all",
      period: "upcoming",
      facility: null,
    },
    scope,
  );

  return (
    <Card className="border-dashed py-10 text-center">
      <CardHeader className="flex flex-col items-center gap-2 pb-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <FilterX className="size-6 text-muted-foreground" />
        </div>
        <CardTitle className="text-lg">条件に合う予約がありません</CardTitle>
        <CardDescription>
          絞り込み条件を変更するか、条件をリセットして再度ご確認ください。
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <Button asChild variant="outline">
          <Link to={resetPath}>絞り込みを解除する</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
