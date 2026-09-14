/**
 * タイムライン上で帯を横に並べるための計算。
 *
 * 同じ施設・同じ時間帯に予約が 2 件以上入ることは、仕様上ふつうに起こる。
 * 重複が禁じられているのは承認済みの予約に対してだけなので（COND-001）、
 * 仮予約どうしは重なってよい。重なった帯を単純に重ねて描くと
 * 後ろの予約が完全に隠れてしまうため、横に分けて並べる。
 *
 * 画面の都合しか持たない計算なので、React から切り離して純粋な関数にしてある。
 */

/** タイムラインに置く 1 件分。その日の 0 時から何分の位置か。 */
export interface TimelineRange {
  readonly startMinutes: number;
  readonly endMinutes: number;
}

/** 1 件をどこに置くかの計算結果。 */
export interface TimelinePlacement<T> {
  readonly item: T;
  /** 左から何番目の列に置くか（0 始まり） */
  readonly column: number;
  /** その帯が属するかたまり全体の列数。幅は 1 / columnCount になる */
  readonly columnCount: number;
}

/**
 * 重なり合う帯を、できるだけ少ない列数で横に並べる。
 *
 * 手順は 2 段階。
 *
 * 1. 時間が地続きにつながっている帯を「かたまり」にまとめる。
 *    かたまりが変われば列数も変わってよいので、
 *    1 日ぜんぶを同じ列数で割るより帯を太く描ける。
 * 2. かたまりの中で、左の列から順に「空いている列」に入れていく。
 *
 * 終わりと始まりが同じ時刻（10:00 に終わって 10:00 に始まる）の場合は
 * 重なっていない扱いにする。終了時刻は予約に含まれないため。
 *
 * 返す順番は開始時刻の昇順で、引数の順番とは限らない。
 */
export const layoutTimelineItems = <T extends TimelineRange>(
  items: readonly T[],
): readonly TimelinePlacement<T>[] => {
  const sorted = [...items].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
  );

  const placements: TimelinePlacement<T>[] = [];

  /** いま組み立てているかたまり */
  let cluster: T[] = [];
  /** かたまりの中でいちばん遅い終了時刻。これより後に始まる帯は別のかたまり */
  let clusterEnd = Number.NEGATIVE_INFINITY;

  /** 1 つのかたまりを列に割り当てて、結果に積む */
  const flushCluster = () => {
    if (cluster.length === 0) return;

    /** 各列がいつまで埋まっているか。添字が列番号 */
    const columnEnds: number[] = [];
    const assigned: { item: T; column: number }[] = [];

    for (const item of cluster) {
      // すでに空いている列があればそこへ。無ければ列を 1 つ増やす
      const found = columnEnds.findIndex((endMinutes) => item.startMinutes >= endMinutes);
      const column = found === -1 ? columnEnds.length : found;

      columnEnds[column] = item.endMinutes;
      assigned.push({ item, column });
    }

    for (const entry of assigned) {
      placements.push({ ...entry, columnCount: columnEnds.length });
    }

    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMinutes >= clusterEnd) flushCluster();

    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }

  flushCluster();

  return placements;
};
