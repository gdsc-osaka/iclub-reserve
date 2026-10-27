import { describe, expect, it } from "vite-plus/test";

import { AppArea } from "~/lib/app-area";

import { toCalendarPathFromFormQuery } from "./paths";

describe("toCalendarPathFromFormQuery", () => {
  const todayKey = "2026-10-26";

  it.each([
    [AppArea.User, "/availability?date=2026-10-26&draft=2026-10-26"],
    [AppArea.Staff, "/staff/availability?date=2026-10-26&draft=2026-10-26"],
  ])(
    "%s でクエリパラメータが何も無いときは、施設なし・今日・日付だけの仮の枠になる",
    (area, expected) => {
      const params = new URLSearchParams();
      expect(toCalendarPathFromFormQuery(area, params, todayKey)).toBe(expected);
    },
  );

  it.each([
    [AppArea.User, "/availability?facility=fac_1&date=2026-11-04&draft=2026-11-04T10:00-11:00"],
    [
      AppArea.Staff,
      "/staff/availability?facility=fac_1&date=2026-11-04&draft=2026-11-04T10:00-11:00",
    ],
  ])("%s で施設・日付・開始・終了がすべて揃っているときはそのまま反映される", (area, expected) => {
    const params = new URLSearchParams(
      "facility=fac_1&date=2026-11-04&start=10:00&end=11:00&mode=direct&created=res_123",
    );
    expect(toCalendarPathFromFormQuery(area, params, todayKey)).toBe(expected);
  });

  it.each([
    [AppArea.User, "/availability?facility=fac_1&date=2026-11-04&draft=2026-11-04"],
    [AppArea.Staff, "/staff/availability?facility=fac_1&date=2026-11-04&draft=2026-11-04"],
  ])(
    "%s で開始だけ、または時刻が壊れているときは時刻なし（日付だけの仮の枠）になる",
    (area, expected) => {
      const paramsStartOnly = new URLSearchParams("facility=fac_1&date=2026-11-04&start=10:00");
      expect(toCalendarPathFromFormQuery(area, paramsStartOnly, todayKey)).toBe(expected);

      const paramsInvalidTime = new URLSearchParams(
        "facility=fac_1&date=2026-11-04&start=10:15&end=11:00",
      );
      expect(toCalendarPathFromFormQuery(area, paramsInvalidTime, todayKey)).toBe(expected);
    },
  );

  it.each([
    [AppArea.User, "/availability?facility=fac_1&date=2026-10-26&draft=2026-10-26"],
    [AppArea.Staff, "/staff/availability?facility=fac_1&date=2026-10-26&draft=2026-10-26"],
  ])("%s で日付が壊れているときは今日になる", (area, expected) => {
    const paramsInvalidDate = new URLSearchParams("facility=fac_1&date=not-a-date");
    expect(toCalendarPathFromFormQuery(area, paramsInvalidDate, todayKey)).toBe(expected);
  });
});
