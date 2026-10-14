import { describe, expect, it } from "vitest";

import {
  addDays,
  atTokyoTime,
  formatDateInput,
  formatDaysUntil,
  formatMonthDayParts,
  formatRelativeTime,
  formatTime,
  formatTimeRange,
  fromCalendarDate,
  isSameTokyoDay,
  parseDateInput,
  parseTokyoDateKey,
  startOfTokyoDay,
  startOfTokyoWeek,
  toCalendarDate,
  toTokyoDateKey,
  tokyoMinutesOfDay,
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

describe("formatMonthDayParts", () => {
  it("日付と曜日を分けて返す", () => {
    expect(formatMonthDayParts(new Date("2026-09-12T10:00:00+09:00"))).toEqual({
      monthDay: "9月12日",
      weekday: "土",
    });
  });

  it("日本時間で判定する", () => {
    // UTC で読むと 9 月 12 日 15 時（＝日本時間 13 日 0 時）が 12 日のままになる
    expect(formatMonthDayParts(new Date("2026-09-13T00:30:00+09:00")).weekday).toBe("日");
  });
});

describe("startOfTokyoWeek", () => {
  it("週の途中の日からその週の日曜を返す", () => {
    // 2026-09-09 は水曜日
    expect(toTokyoDateKey(startOfTokyoWeek(new Date("2026-09-09T14:00:00+09:00")))).toBe(
      "2026-09-06",
    );
  });

  it("土曜はその週の日曜（6 日前）を返す", () => {
    // 土曜を「次の週の始まり」と取り違えると、土曜だけ 1 週ずれる
    expect(toTokyoDateKey(startOfTokyoWeek(new Date("2026-09-12T10:00:00+09:00")))).toBe(
      "2026-09-06",
    );
  });

  it("日曜はその日を返す", () => {
    expect(toTokyoDateKey(startOfTokyoWeek(new Date("2026-09-13T00:00:00+09:00")))).toBe(
      "2026-09-13",
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

describe("formatTimeRange", () => {
  it("同じ日に終わる予約は時刻だけで表す", () => {
    const result = formatTimeRange(
      new Date("2026-09-12T10:00:00+09:00"),
      new Date("2026-09-12T12:00:00+09:00"),
    );

    expect(result).toBe("10:00〜12:00");
  });

  it("翌日に終わる予約には「翌」を付ける", () => {
    // ここを時刻だけで書くと「20:00〜10:00」となり、逆向きの範囲に見える
    const result = formatTimeRange(
      new Date("2026-09-12T20:00:00+09:00"),
      new Date("2026-09-13T10:00:00+09:00"),
    );

    expect(result).toBe("20:00〜翌10:00");
  });

  it("2 日以上またぐ予約には終わりの日付を書く", () => {
    const result = formatTimeRange(
      new Date("2026-09-12T20:00:00+09:00"),
      new Date("2026-09-14T10:00:00+09:00"),
    );

    expect(result).toBe("20:00〜9月14日(月) 10:00");
  });

  it("日をまたぐ判定は日本時間で行う", () => {
    // どちらも UTC では 9/12 だが、日本時間では 9/12 と 9/13
    const result = formatTimeRange(
      new Date("2026-09-12T23:00:00+09:00"),
      new Date("2026-09-13T01:00:00+09:00"),
    );

    expect(result).toBe("23:00〜翌01:00");
  });
});

describe("toCalendarDate / fromCalendarDate", () => {
  it("カレンダー部品には、ブラウザの時間帯のその日の 0 時を渡す", () => {
    const date = toCalendarDate("2026-09-19");

    // 日本時間に読み替えず、その場の時間帯で 9/19 の 0 時として組み立てる
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(19);
    expect(date?.getHours()).toBe(0);
  });

  it("形式が違えば undefined を返す", () => {
    expect(toCalendarDate("2026/09/19")).toBeUndefined();
    expect(toCalendarDate("")).toBeUndefined();
  });

  it("カレンダー部品が返した日付を、そのまま文字列に戻せる", () => {
    const dateKey = "2026-09-19";

    expect(fromCalendarDate(toCalendarDate(dateKey) as Date)).toBe(dateKey);
  });

  it("1 桁の月日も 2 桁に揃える", () => {
    expect(fromCalendarDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("日付の変わり目でも、その場の時間帯の日付をそのまま返す", () => {
    /*
     * 日本時間では 9/20 の 0 時でも、UTC のブラウザでは 9/19 の 15 時。
     * `toTokyoDateKey` を使うとここが 1 日ずれる。
     */
    const localMidnight = new Date(2026, 8, 20, 0, 0, 0);

    expect(fromCalendarDate(localMidnight)).toBe("2026-09-20");
  });
});

describe("parseDateInput", () => {
  it("区切りが違っても読み取る", () => {
    expect(parseDateInput("2026-09-25")).toBe("2026-09-25");
    expect(parseDateInput("2026/09/25")).toBe("2026-09-25");
    expect(parseDateInput("2026年9月25日")).toBe("2026-09-25");
  });

  it("1 桁の月日を 2 桁に揃える", () => {
    expect(parseDateInput("2026/9/5")).toBe("2026-09-05");
  });

  it("前後の空白は無視する", () => {
    expect(parseDateInput("  2026/9/25  ")).toBe("2026-09-25");
  });

  it("打ちかけの文字は読み取らない", () => {
    // 打っている途中で勝手に日付が決まらないこと
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput("2026")).toBeNull();
    expect(parseDateInput("2026/")).toBeNull();
    expect(parseDateInput("2026/9")).toBeNull();
  });

  it("存在しない日付は読み取らない", () => {
    expect(parseDateInput("2026/2/31")).toBeNull();
    expect(parseDateInput("2026/13/1")).toBeNull();
  });

  it("2 桁の年や、余計な文字が付いたものは読み取らない", () => {
    expect(parseDateInput("26/9/25")).toBeNull();
    expect(parseDateInput("2026/9/25 10:00")).toBeNull();
  });
});

describe("formatDateInput", () => {
  it("入力欄に出す形にする", () => {
    expect(formatDateInput("2026-09-25")).toBe("2026/09/25");
  });

  it("出した形を、そのまま読み取り直せる", () => {
    const dateKey = "2026-01-05";

    expect(parseDateInput(formatDateInput(dateKey))).toBe(dateKey);
  });
});

describe("formatRelativeTime", () => {
  const baseNow = new Date("2026-10-14T15:00:00+09:00");

  it("1分未満は「0分前」を返す", () => {
    const target = new Date("2026-10-14T14:59:30+09:00");
    expect(formatRelativeTime(target, baseNow)).toBe("0分前");
  });

  it("当日の1時間未満は「n分前」を返す", () => {
    const target10m = new Date("2026-10-14T14:50:00+09:00");
    expect(formatRelativeTime(target10m, baseNow)).toBe("10分前");

    const target59m = new Date("2026-10-14T14:01:00+09:00");
    expect(formatRelativeTime(target59m, baseNow)).toBe("59分前");
  });

  it("当日の1時間以上は「n時間前」を返す", () => {
    const target1h = new Date("2026-10-14T14:00:00+09:00");
    expect(formatRelativeTime(target1h, baseNow)).toBe("1時間前");

    const target5h = new Date("2026-10-14T10:00:00+09:00");
    expect(formatRelativeTime(target5h, baseNow)).toBe("5時間前");
  });

  it("前日の時刻は「昨日 HH:mm」を返す", () => {
    const targetYesterday = new Date("2026-10-13T10:30:00+09:00");
    expect(formatRelativeTime(targetYesterday, baseNow)).toBe("昨日 10:30");
  });

  it("前日以前（2日以上前）は「M/D」を返す", () => {
    const target2DaysAgo = new Date("2026-10-12T10:30:00+09:00");
    expect(formatRelativeTime(target2DaysAgo, baseNow)).toBe("10/12");

    const targetSingleDigit = new Date("2026-10-05T09:15:00+09:00");
    expect(formatRelativeTime(targetSingleDigit, baseNow)).toBe("10/5");

    const targetOtherMonth = new Date("2026-04-01T12:00:00+09:00");
    expect(formatRelativeTime(targetOtherMonth, baseNow)).toBe("4/1");
  });
});

describe("formatDaysUntil", () => {
  const baseNow = new Date("2026-10-15T14:30:00+09:00");

  it("当日（日本時間で同じ日）の予約は「今日」を返す", () => {
    // 同じ日の過去時刻・未来時刻
    expect(formatDaysUntil(new Date("2026-10-15T10:00:00+09:00"), baseNow)).toBe("今日");
    expect(formatDaysUntil(new Date("2026-10-15T18:00:00+09:00"), baseNow)).toBe("今日");
    // 23:59 でも「今日」
    expect(formatDaysUntil(new Date("2026-10-15T23:59:59+09:00"), baseNow)).toBe("今日");
  });

  it("翌日（日本時間で +1 日）の予約は「明日」を返す", () => {
    expect(formatDaysUntil(new Date("2026-10-16T00:00:00+09:00"), baseNow)).toBe("明日");
    expect(formatDaysUntil(new Date("2026-10-16T15:00:00+09:00"), baseNow)).toBe("明日");
    expect(formatDaysUntil(new Date("2026-10-16T23:59:00+09:00"), baseNow)).toBe("明日");
  });

  it("2日以上先の予約は「あと n 日」を返す", () => {
    expect(formatDaysUntil(new Date("2026-10-17T10:00:00+09:00"), baseNow)).toBe("あと 2 日");
    expect(formatDaysUntil(new Date("2026-10-18T10:00:00+09:00"), baseNow)).toBe("あと 3 日");
    expect(formatDaysUntil(new Date("2026-10-25T10:00:00+09:00"), baseNow)).toBe("あと 10 日");
  });

  it("月をまたぐ場合でも日本時間の日数差で正確に計算する", () => {
    // 10/31 から 11/1 は「明日」
    const endOfMonth = new Date("2026-10-31T23:30:00+09:00");
    expect(formatDaysUntil(new Date("2026-11-01T09:00:00+09:00"), endOfMonth)).toBe("明日");
    // 10/31 から 11/2 は「あと 2 日」
    expect(formatDaysUntil(new Date("2026-11-02T09:00:00+09:00"), endOfMonth)).toBe("あと 2 日");
  });

  it("UTC では前日または翌日になる時刻でも日本時間の日付で判定する", () => {
    // baseNow (10/15 14:30 JST = 10/15 05:30 UTC)
    // 10/16 02:00 JST (= 10/15 17:00 UTC) -> 日本時間では翌日なので「明日」
    const targetTomorrowEarly = new Date("2026-10-16T02:00:00+09:00");
    expect(formatDaysUntil(targetTomorrowEarly, baseNow)).toBe("明日");
  });
});
