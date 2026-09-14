import { describe, expect, it } from "vitest";

import { layoutTimelineItems, type TimelineRange } from "./timeline-layout";

/** 「9:00-10:30」のような書き方で範囲を作る、テスト用の道具 */
const range = (start: string, end: string): TimelineRange & { label: string } => {
  const toMinutes = (value: string) => {
    const [hour, minute] = value.split(":").map(Number);

    return hour * 60 + minute;
  };

  return { startMinutes: toMinutes(start), endMinutes: toMinutes(end), label: `${start}-${end}` };
};

/** 検証しやすいように「ラベル: 列/列数」の形にそろえる */
const summarize = (
  placements: readonly { item: { label: string }; column: number; columnCount: number }[],
) =>
  placements.map(
    (placement) => `${placement.item.label}: ${placement.column}/${placement.columnCount}`,
  );

describe("layoutTimelineItems", () => {
  it("予約が 1 件も無いときは空の配列を返す", () => {
    expect(layoutTimelineItems([])).toEqual([]);
  });

  it("重ならない予約はすべて 1 列に収まる", () => {
    const placements = layoutTimelineItems([range("9:00", "10:00"), range("13:00", "14:00")]);

    expect(summarize(placements)).toEqual(["9:00-10:00: 0/1", "13:00-14:00: 0/1"]);
  });

  it("終わりと始まりが同じ時刻なら重なっていない扱いにする", () => {
    // 終了時刻は予約に含まれないので、10:00 に終わる予約と 10:00 に始まる予約は並べない
    const placements = layoutTimelineItems([range("9:00", "10:00"), range("10:00", "11:00")]);

    expect(summarize(placements)).toEqual(["9:00-10:00: 0/1", "10:00-11:00: 0/1"]);
  });

  it("重なった 2 件は横に分けて並べる", () => {
    // 仮予約どうしは重なってよい（COND-001 が禁じているのは承認済みとの重複だけ）
    const placements = layoutTimelineItems([range("9:00", "11:00"), range("10:00", "12:00")]);

    expect(summarize(placements)).toEqual(["9:00-11:00: 0/2", "10:00-12:00: 1/2"]);
  });

  it("先に置いた予約が終わったら、同じ列を次の予約に使い回す", () => {
    const placements = layoutTimelineItems([
      range("9:00", "13:00"),
      range("9:30", "10:30"),
      range("11:00", "12:00"),
    ]);

    // 2 件目が終わったあとの 3 件目は、列を増やさず 1 列目に入る
    expect(summarize(placements)).toEqual([
      "9:00-13:00: 0/2",
      "9:30-10:30: 1/2",
      "11:00-12:00: 1/2",
    ]);
  });

  it("時間が離れていれば別のかたまりとして数え直す", () => {
    const placements = layoutTimelineItems([
      range("9:00", "11:00"),
      range("9:00", "11:00"),
      range("14:00", "15:00"),
    ]);

    // 午前は 2 列必要でも、午後の予約まで半分の幅にはしない
    expect(summarize(placements)).toEqual([
      "9:00-11:00: 0/2",
      "9:00-11:00: 1/2",
      "14:00-15:00: 0/1",
    ]);
  });

  it("渡した順番に関係なく、開始時刻の昇順で返す", () => {
    const placements = layoutTimelineItems([range("15:00", "16:00"), range("9:00", "10:00")]);

    expect(summarize(placements)).toEqual(["9:00-10:00: 0/1", "15:00-16:00: 0/1"]);
  });

  it("3 件が同じ時間帯に重なったら 3 列になる", () => {
    const placements = layoutTimelineItems([
      range("10:00", "12:00"),
      range("10:00", "12:00"),
      range("10:00", "12:00"),
    ]);

    expect(summarize(placements)).toEqual([
      "10:00-12:00: 0/3",
      "10:00-12:00: 1/3",
      "10:00-12:00: 2/3",
    ]);
  });
});
