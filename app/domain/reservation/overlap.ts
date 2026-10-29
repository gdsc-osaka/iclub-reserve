import type { Reservation } from "./index";

/**
 * 重なりを判定するのに使う項目。
 *
 * 施設・時間帯の重複確認に用いる。独自の型を作らず、Reservation から Pick する。
 */
export type ReservationSlot = Pick<Reservation, "facilityId" | "startAt" | "endAt">;

/**
 * まとまりを作るのに使う項目。
 *
 * 重なり判定の項目に加え、予約の識別と申請順の整列に必要な id と requestedAt を持つ。
 */
export type OverlapMember = ReservationSlot & Pick<Reservation, "id" | "requestedAt">;

/**
 * 同じ施設で、時間帯が重なるか（COND-031）。
 *
 * SQL の hasOverlappingReservation や ensureNoApprovedOverlap と同じ決まりであり、
 * 終了時刻はその予約に含まれないため、10:00 に終わる予約と 10:00 に始まる予約は重ならない。
 */
export const overlapsReservation = (a: ReservationSlot, b: ReservationSlot): boolean =>
  a.facilityId === b.facilityId &&
  a.startAt.getTime() < b.endAt.getTime() &&
  a.endAt.getTime() > b.startAt.getTime();

/**
 * 重なりを順にたどってつながる予約を 1 つのまとまりにする（COND-031 (1)）。
 *
 * どのまとまりも、申請日時の古い順（同じなら id の順）に並べる。
 * まとまりどうしは、先頭（最も古い申請日時）の順に並べる。
 * 重なる相手の無い予約も、1 件だけのまとまりとして返す。
 */
export const toOverlapClusters = <T extends OverlapMember>(
  items: readonly T[],
): readonly (readonly T[])[] => {
  if (items.length === 0) {
    return [];
  }

  const compareMembers = (a: T, b: T): number => {
    const diff = a.requestedAt.getTime() - b.requestedAt.getTime();
    if (diff !== 0) return diff;
    return a.id.localeCompare(b.id);
  };

  const n = items.length;
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlapsReservation(items[i]!, items[j]!)) {
        adj[i]!.push(j);
        adj[j]!.push(i);
      }
    }
  }

  const visited = new Set<number>();
  const clusters: T[][] = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;

    const component: T[] = [];
    const queue: number[] = [i];
    visited.add(i);

    while (queue.length > 0) {
      const u = queue.shift()!;
      component.push(items[u]!);

      for (const v of adj[u]!) {
        if (!visited.has(v)) {
          visited.add(v);
          queue.push(v);
        }
      }
    }

    component.sort(compareMembers);
    clusters.push(component);
  }

  clusters.sort((c1, c2) => compareMembers(c1[0]!, c2[0]!));

  return clusters;
};

/**
 * `targetId` の予約を含むまとまりを返す。`items` に無ければ空の配列。
 */
export const toOverlapCluster = <T extends OverlapMember>(
  targetId: string,
  items: readonly T[],
): readonly T[] => {
  const clusters = toOverlapClusters(items);
  return clusters.find((cluster) => cluster.some((item) => item.id === targetId)) ?? [];
};

/**
 * 承認する予約を選んだときに、まとめて却下する予約（COND-031 (3)）。
 *
 * まとまりの中で、承認する予約と重なるもの。承認する予約自身は含めない。並びはまとまりのまま。
 */
export const toOverlapRejections = <T extends OverlapMember>(
  winner: Pick<Reservation, "id"> & ReservationSlot,
  cluster: readonly T[],
): readonly T[] =>
  cluster.filter((item) => item.id !== winner.id && overlapsReservation(winner, item));
