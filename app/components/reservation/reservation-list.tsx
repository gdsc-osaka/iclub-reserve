import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import type { ReservationActor } from "~/domain/reservation";
import type { ParsedReservationListParams } from "~/routes/reservations/list/query-params";
import type { ReservationListResult } from "~/usecases/reservation/get-reservation-list";
import { ReservationListEmpty } from "./reservation-list-empty";
import { ReservationListFilters } from "./reservation-list-filters";
import { ReservationListRow } from "./reservation-list-row";

interface ReservationListProps {
  readonly result: ReservationListResult;
  readonly params: ParsedReservationListParams;
  readonly scope: "own" | "all";
  readonly now: Date;
  readonly actionError?: string | null;
}

/**
 * 予約一覧・管理画面（SCR-003）の共通表示コンポーネント。
 *
 * /reservations（自団体）と /staff/reservations（全団体・事務局）で共有する。
 * 両者の違いは「取得データのスコープ」と「団体名バッジを表示するか」のみ。
 */
export function ReservationList({
  result,
  params,
  scope,
  now,
  actionError,
}: Readonly<ReservationListProps>) {
  const { groups, selectedGroup, items, counts, facilities, viewerMembership } = result;

  /*
   * 見ている人。事務局の画面（scope="all"）では事務局の権限で、
   * 自団体の画面では団体での役割（viewerMembership）で操作の可否が決まる（COND-009）。
   */
  const actor: ReservationActor = { isStaff: scope === "all", membership: viewerMembership };

  const noGroups = scope === "own" && groups.length === 0;
  const isStaffProvisionalEmpty =
    scope === "all" && params.status === "provisional" && items.length === 0;
  const isEmpty = items.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      {/* 画面ヘッダー */}
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">
          {scope === "all" ? "予約の承認・管理" : "予約一覧"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {scope === "all"
            ? "全団体の予約の確認・承認待ち申請の一覧です。"
            : "所属団体の予約状況を確認できます。"}
        </p>
      </div>

      {/* アクション実行失敗時のエラー表示 */}
      {actionError && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>操作に失敗しました</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* 絞り込みフィルター（所属 0 件のときは表示しない） */}
      {!noGroups && (
        <ReservationListFilters
          groups={groups}
          selectedGroup={selectedGroup}
          counts={counts}
          facilities={facilities}
          params={params}
          scope={scope}
        />
      )}

      {/* 一覧本体または空状態 */}
      {isEmpty ? (
        <ReservationListEmpty
          noGroups={noGroups}
          isStaffProvisionalEmpty={isStaffProvisionalEmpty}
          scope={scope}
          params={params}
        />
      ) : (
        <ul className="flex flex-col gap-3" role="list">
          {items.map((item) => (
            <ReservationListRow
              key={item.id}
              item={item}
              showGroupName={scope === "all"}
              actor={actor}
              now={now}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
