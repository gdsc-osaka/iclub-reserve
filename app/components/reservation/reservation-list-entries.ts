import { ReservationStatus } from "~/domain/reservation";
import { toOverlapClusters } from "~/domain/reservation/overlap";
import type { ReservationListItem } from "~/query/reservation/reservation-list";

export type ReservationListEntry =
  | { readonly kind: "row"; readonly item: ReservationListItem }
  | { readonly kind: "overlap"; readonly items: readonly ReservationListItem[] };

/**
 * 一覧に並べるものを決める（UC-033・COND-031 (1)）。
 * 事務局の画面だけ、重なり合う仮予約（2 件以上のまとまり）を 1 つにまとめ、まとまりの中で一覧の並びが最も前の予約の位置に置く。
 * まとまりの中は申請日時の古い順。利用者の画面では、すべて行のまま返す。
 */
export const toReservationListEntries = (
  items: readonly ReservationListItem[],
  isStaffArea: boolean,
): readonly ReservationListEntry[] => {
  if (!isStaffArea || items.length === 0) {
    return items.map((item) => ({ kind: "row", item }));
  }

  // 仮予約のみを抽出してまとまりを作る
  const provisionals = items.filter((item) => item.status === ReservationStatus.Provisional);
  const clusters = toOverlapClusters(provisionals);

  // 2 件以上のまとまりだけを対象にする（1 件だけのまとまりは重なりがないので行のまま）
  const multiItemClusters = clusters.filter((c) => c.length >= 2);

  // 各予約 ID がどのまとまりに属するかをマップ化
  const clusterByItemId = new Map<string, readonly ReservationListItem[]>();
  for (const cluster of multiItemClusters) {
    for (const item of cluster) {
      clusterByItemId.set(item.id, cluster);
    }
  }

  // 既にまとまりとして出力したクラスタを記録（最初の出現位置でだけ出す）
  const emittedClusters = new Set<readonly ReservationListItem[]>();
  const entries: ReservationListEntry[] = [];

  for (const item of items) {
    const cluster = clusterByItemId.get(item.id);
    if (cluster === undefined) {
      // まとまりに属さない（仮予約以外、または 1 件だけの仮予約）
      entries.push({ kind: "row", item });
    } else if (!emittedClusters.has(cluster)) {
      // まとまりの中で元の一覧で最も前の予約の位置で 1 回だけ出す
      emittedClusters.add(cluster);
      entries.push({ kind: "overlap", items: cluster });
    }
    // 後続の同一まとまりの要素はスキップ（まとまりの位置にだけ出す）
  }

  return entries;
};
