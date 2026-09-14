import { describe, expect, it } from "vitest";

import {
  addDays,
  atTokyoTime,
  formatTime,
  isSameTokyoDay,
  parseTokyoDateKey,
  startOfTokyoDay,
  startOfTokyoWeek,
  tokyoMinutesOfDay,
  toTokyoDateKey,
} from "./date";

describe("startOfTokyoDay", () => {
  it("日本時間のその日の 0 時を返す", () => {
    const result = startOfTokyoDay(new Date("2026-09-12T14:20:00+09:00"));

    expect(result.toISOString()).toBe("2026-09-11T15:00:00.000Z");
  });

  it("UTC では前日になる時刻でも、日本時間の日付で切る", () => {
    // 日本時間 9/12 の 0:30 は UTC では 9/11。ここを取り違えると 1 日ずれる
    const result = startOfTokyoDay(new Date("2026-09-12T00:30:00+09:00"));

    expect(toTokyoDateKey(result)).toBe("2026-09-12");
  });
});

describe("toTokyoDateKey", () => {
  it("日本時間の日付を返す", () => {
    expect(toTokyoDateKey(new Date("2026-09-12T23:59:00+09:00"))).toBe("2026-09-12");
  });

  it("日本時間の 0 時ちょうどでも前日にならない", () => {
    expect(toTokyoDateKey(new Date("2026-09-12T00:00:00+09:00"))).toBe("2026-09-12");
  });
});

describe("parseTokyoDateKey", () => {
  it("日本時間のその日の 0 時に変換する", () => {
    expect(parseTokyoDateKey("2026-09-12")?.toISOString()).toBe("2026-09-11T15:00:00.000Z");
  });

  it("形式が違うときは null を返す", () => {
    // URL のクエリは利用者が自由に書き換えられるので、必ず弾けること
    expect(parseTokyoDateKey("2026/09/12")).toBeNull();
    expect(parseTokyoDateKey("きょう")).toBeNull();
    expect(parseTokyoDateKey(null)).toBeNull();
  });

  it("存在しない日付は null を返す", () => {
    // Date に渡すと 3 月に繰り上がってしまうので、黙って別の日を表示させない
    expect(parseTokyoDateKey("2026-02-31")).toBeNull();
    expect(parseTokyoDateKey("2026-13-01")).toBeNull();
  });

  it("変換した結果をもう一度文字列に戻すと元に戻る", () => {
    expect(toTokyoDateKey(parseTokyoDateKey("2026-09-12") as Date)).toBe("2026-09-12");
  });
});

describe("startOfTokyoWeek", () => {
  it("週の途中の日からその週の月曜を返す", () => {
    // 2026-09-12 は土曜日
    expect(toTokyoDateKey(startOfTokyoWeek(new Date("2026-09-12T14:00:00+09:00")))).toBe(
      "2026-09-07",
    );
  });

  it("日曜はその週の月曜（6 日前）を返す", () => {
    // 日曜を「次の週の始まり」と取り違えると、日曜だけ 1 週ずれる
    expect(toTokyoDateKey(startOfTokyoWeek(new Date("2026-09-13T10:00:00+09:00")))).toBe(
      "2026-09-07",
    );
  });

  it("月曜はその日を返す", () => {
    expect(toTokyoDateKey(startOfTokyoWeek(new Date("2026-09-07T00:00:00+09:00")))).toBe(
      "2026-09-07",
    );
  });
});

describe("addDays", () => {
  it("月をまたいでも正しく進む", () => {
    expect(toTokyoDateKey(addDays(new Date("2026-09-28T00:00:00+09:00"), 7))).toBe("2026-10-05");
  });

  it("負の数を渡すと戻る", () => {
    expect(toTokyoDateKey(addDays(new Date("2026-09-07T00:00:00+09:00"), -7))).toBe("2026-08-31");
  });
});

describe("tokyoMinutesOfDay", () => {
  it("日本時間での 0 時からの分数を返す", () => {
    expect(tokyoMinutesOfDay(new Date("2026-09-12T14:30:00+09:00"))).toBe(14 * 60 + 30);
  });
});

describe("atTokyoTime", () => {
  it("その日の指定した時刻を返す", () => {
    const result = atTokyoTime(new Date("2026-09-12T23:00:00+09:00"), 9);

    expect(formatTime(result)).toBe("09:00");
    expect(toTokyoDateKey(result)).toBe("2026-09-12");
  });
});

describe("isSameTokyoDay", () => {
  it("日本時間で同じ日なら true", () => {
    expect(
      isSameTokyoDay(new Date("2026-09-12T00:10:00+09:00"), new Date("2026-09-12T23:50:00+09:00")),
    ).toBe(true);
  });

  it("日本時間で日付が変わっていれば false", () => {
    expect(
      isSameTokyoDay(new Date("2026-09-12T23:50:00+09:00"), new Date("2026-09-13T00:10:00+09:00")),
    ).toBe(false);
  });
});
