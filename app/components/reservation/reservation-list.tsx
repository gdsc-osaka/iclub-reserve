import { cn } from "cn";
import { CircleAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import type { ReservationActor } from "~/domain/reservation/transition";
import type { ParsedReservationListParams } from "~/routes/reservations/list/query-params";
import type { ReservationListResult } from "~/usecases/reservation/get-reservation-list";
import { ReservationListEmpty } from "./reservation-list-empty";
import { ReservationListFilters, ReservationListGroupSwitcher } from "./reservation-list-filters";
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
 * 両者の違いは「取得データのスコープ」と、見出しの団体の切り替え・行の団体名バッジのどちらを出すかだけ。
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
  /*
   * 「承認待ちはすべて処理されています」と言えるのは、既定の絞り込み（今後の予約・
   * 全施設）で 0 件のときだけ。施設や期間で絞った結果が 0 件なのに同じ文を出すと、
   * 別の施設に承認待ちが残っていても片付いたように読めてしまう。
   */
  const isStaffProvisionalEmpty =
    scope === "all" &&
    params.status === "provisional" &&
    params.period === "upcoming" &&
    params.facility === null &&
    items.length === 0;
  const isEmpty = items.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      {/*
       * 見出しと絞り込みは、スクロールしてもアプリの上部バーのすぐ下に残す（sticky）。
       * 一覧の途中まで読み進めても、いまどの団体・状態を見ているのかが分かり、すぐに切り替えられる。
       *
       * - main の余白（p-4 md:p-6）の分も背景で塗るため、負のマージンで横と上へ広げる。
       *   広げないと、余白の隙間から後ろを流れる行が透けて見える。
       * - 重なり順は、上部バー（z-20）より下、行の操作ボタン（relative z-10）より上。
       *   同じ z-10 だと、後に描かれる行のボタンが見出しの上に出てしまう。
       * - 下端はタブの下線にそろえ、一覧との境目にする（`ReservationListFilters` を参照）。
       */}
      <div
        className={cn(
          "sticky top-(--app-header-height) z-15 flex flex-col gap-3 bg-background md:gap-4",
          "-mx-4 -mt-4 px-4 pt-4 md:-mx-6 md:-mt-6 md:px-6 md:pt-6",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <h1 className="shrink-0 text-xl font-bold tracking-tight md:text-2xl">
            {scope === "all" ? "予約の承認・管理" : "予約一覧"}
          </h1>

          {/* 団体の切り替え（事務局の画面は全団体を見るので出さない） */}
          {scope === "own" && (
            <ReservationListGroupSwitcher
              groups={groups}
              selectedGroup={selectedGroup}
              params={params}
            />
          )}
        </div>

        {/* 絞り込み（所属 0 件のときは表示しない） */}
        {!noGroups && (
          <ReservationListFilters
            counts={counts}
            facilities={facilities}
            params={params}
            scope={scope}
          />
        )}
      </div>

      {/* アクション実行失敗時のエラー表示 */}
      {actionError && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>操作に失敗しました</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
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
