import { CalendarDays, FilterX, Users } from "lucide-react";
import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
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
      <Empty className="border bg-card py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Users aria-hidden />
          </EmptyMedia>
          <EmptyTitle>まだどの団体にも所属していません</EmptyTitle>
          <EmptyDescription>
            予約を申請するには、団体に参加するか団体を登録して、事務局の承認を受ける必要があります。
            空き状況の確認は所属がなくてもご利用いただけます。
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link to="/availability" className="inline-flex items-center gap-2">
              <CalendarDays />
              空き状況を見る
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  // 2. 事務局の承認待ちが 0 件の場合
  if (isStaffProvisionalEmpty) {
    return (
      <Empty className="border bg-card py-10">
        <EmptyHeader>
          <EmptyTitle className="text-base">承認を待っている申請はありません</EmptyTitle>
        </EmptyHeader>
      </Empty>
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
    <Empty className="border bg-card py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FilterX aria-hidden />
        </EmptyMedia>
        <EmptyTitle>条件に合う予約がありません</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild variant="outline">
          <Link to={resetPath}>絞り込みを解除する</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
