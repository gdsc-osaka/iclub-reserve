import { describe, expect, it } from "vitest";

import { blockContent, buildDays, weekdayLabel, weekdayStyle } from "./availability-week";

describe("weekdayStyle", () => {
  it("土曜は青系、日曜は赤系の色を返す", () => {
    expect(weekdayStyle({ weekday: 6, isHoliday: false }).label).toContain("blue");
    expect(weekdayStyle({ weekday: 0, isHoliday: false }).label).toContain("red");
  });

  it("祝日は日曜と同じ赤系の色を返す", () => {
    // 平日の祝日
    expect(weekdayStyle({ weekday: 1, isHoliday: true }).label).toContain("red");
    expect(weekdayStyle({ weekday: 1, isHoliday: true }).surface).toContain("red");
  });

  it("土曜の祝日は赤系になる（祝日を土曜より優先する）", () => {
    expect(weekdayStyle({ weekday: 6, isHoliday: true }).label).toContain("red");
    expect(weekdayStyle({ weekday: 6, isHoliday: true }).surface).toContain("red");
  });

  it("面の色は曜日の色と同じ系統にする", () => {
    // 見出しと列に同じ色を敷くので、文字の色と系統が違うとちぐはぐに見える
    expect(weekdayStyle({ weekday: 6, isHoliday: false }).surface).toContain("blue");
    expect(weekdayStyle({ weekday: 0, isHoliday: false }).surface).toContain("red");
  });

  it("平日は色を付けない", () => {
    // null と空文字を取り違えると、今日の色と平日の色の区別がつかなくなる
    expect(weekdayStyle({ weekday: 3, isHoliday: false })).toEqual({ label: null, surface: null });
  });
});

describe("weekdayLabel", () => {
  it("祝日なら「月・祝」のように曜日の後に「・祝」を付ける", () => {
    // 2026-09-14 は月曜日
    const holidayDay = {
      date: new Date("2026-09-14T00:00:00+09:00"),
      isHoliday: true,
    };
    expect(weekdayLabel(holidayDay)).toBe("月・祝");
  });

  it("祝日でなければ従来どおり「月」を返す", () => {
    const normalDay = {
      date: new Date("2026-09-14T00:00:00+09:00"),
      isHoliday: false,
    };
    expect(weekdayLabel(normalDay)).toBe("月");
  });

  it("日曜や土曜の祝日も「日・祝」「土・祝」になる", () => {
    const sundayHoliday = {
      date: new Date("2026-09-13T00:00:00+09:00"), // 日曜
      isHoliday: true,
    };
    const saturdayHoliday = {
      date: new Date("2026-09-19T00:00:00+09:00"), // 土曜
      isHoliday: true,
    };
    expect(weekdayLabel(sundayHoliday)).toBe("日・祝");
    expect(weekdayLabel(saturdayHoliday)).toBe("土・祝");
  });
});

describe("buildDays", () => {
  it("開始日から指定した日数を並べ、祝日と今日に印を付ける", () => {
    const start = new Date("2026-09-13T00:00:00+09:00"); // 日曜
    const today = new Date("2026-09-14T09:00:00+09:00");
    const holidayDateKeys = ["2026-09-15"];

    const days = buildDays(start, 28, today, holidayDateKeys);

    expect(days).toHaveLength(28);
    expect(days[0].dateKey).toBe("2026-09-13");
    expect(days[0].isHoliday).toBe(false);
    expect(days[1].isToday).toBe(true);
    expect(days[2].dateKey).toBe("2026-09-15");
    expect(days[2].isHoliday).toBe(true);
    expect(days[27].dateKey).toBe("2026-10-10");
  });
});

describe("blockContent", () => {
  it("1 時間の帯には時刻と団体名 2 行が入る", () => {
    expect(blockContent(60, 1)).toEqual({
      showTime: true,
      showStatus: false,
      showHeadCount: false,
      nameLines: 2,
    });
  });

  it("横に 2 つ並ぶと団体名だけにして、行をすべて回す", () => {
    // 幅が半分になるので、時刻やステータスまで書くとどの行も数文字で切れる
    expect(blockContent(60, 2)).toEqual({
      showTime: false,
      showStatus: false,
      showHeadCount: false,
      nameLines: 3,
    });
  });

  it("横に並んだ長い帯でも、団体名の折り返しは 6 行で打ち止めにする", () => {
    expect(blockContent(300, 2).nameLines).toBe(6);
  });

  it("短い帯は団体名だけにする", () => {
    expect(blockContent(30, 1)).toEqual({
      showTime: false,
      showStatus: false,
      showHeadCount: false,
      nameLines: 1,
    });
  });

  it("長い帯にはステータスと使用人数まで入る", () => {
    const tall = blockContent(180, 1);

    expect(tall.showTime).toBe(true);
    expect(tall.showStatus).toBe(true);
    expect(tall.showHeadCount).toBe(true);
  });

  it("団体名の折り返しは 3 行で打ち止めにする", () => {
    // 行数をそのまま増やすと、長い帯で団体名だけが縦に伸びてしまう
    expect(blockContent(600, 1).nameLines).toBe(3);
  });
});
