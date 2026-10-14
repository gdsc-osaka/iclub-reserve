import { describe, expect, it } from "vitest";

import type { HolidayItem } from "~/domain/holiday";
import { useD1TestDb } from "../d1-test-db";
import { createD1HolidayQuery } from "./d1-holiday-query";
import { createD1HolidayRepository } from "./d1-holiday-repository";

const testDb = useD1TestDb();

describe("d1-holiday", () => {
  describe("createD1HolidayRepository", () => {
    it("50行を超える大量の祝日もチャンク分割されて保存できる", async () => {
      const repository = createD1HolidayRepository(testDb.db);
      const query = createD1HolidayQuery(testDb.db);

      // 120 件（1 文 50 行の上限を超える件数）。日付は年ごとにずらして重ならないようにする
      const holidays: HolidayItem[] = Array.from({ length: 120 }, (_, i) => ({
        date: `${2000 + i}-01-01`,
        name: `元日_${2000 + i}`,
      }));

      const saveResult = await repository.replaceAll(holidays);
      expect(saveResult.isOk()).toBe(true);

      const findResult = await query.findHolidaysBetween("2000-01-01", "2119-12-31");
      expect(findResult.isOk()).toBe(true);
      expect(findResult._unsafeUnwrap().length).toBe(120);
    });

    it("入れ直したときに古い行が残らない（全件削除して置き換えられる）", async () => {
      const repository = createD1HolidayRepository(testDb.db);
      const query = createD1HolidayQuery(testDb.db);

      // 1回目の保存
      await repository.replaceAll([
        { date: "2025-01-01", name: "元日" },
        { date: "2025-01-13", name: "成人の日" },
      ]);

      // 2回目の保存（古い日付を含まない新しいデータ）
      const saveResult = await repository.replaceAll([
        { date: "2025-02-11", name: "建国記念の日" },
        { date: "2025-02-23", name: "天皇誕生日" },
      ]);
      expect(saveResult.isOk()).toBe(true);

      // 1回目のデータ（2025-01-01 など）が消えていることを確認
      const oldCheck = await query.findHolidaysBetween("2025-01-01", "2025-01-31");
      expect(oldCheck._unsafeUnwrap()).toEqual([]);

      // 2回目のデータだけが残っていることを確認
      const newCheck = await query.findHolidaysBetween("2025-02-01", "2025-02-28");
      expect(newCheck._unsafeUnwrap()).toEqual(["2025-02-11", "2025-02-23"]);
    });
  });

  describe("createD1HolidayQuery", () => {
    it("指定した期間内（両端を含む）の祝日日付を昇順で返す", async () => {
      const repository = createD1HolidayRepository(testDb.db);
      const query = createD1HolidayQuery(testDb.db);

      await repository.replaceAll([
        { date: "2025-04-29", name: "昭和の日" },
        { date: "2025-05-03", name: "憲法記念日" },
        { date: "2025-05-04", name: "みどりの日" },
        { date: "2025-05-05", name: "こどもの日" },
        { date: "2025-05-06", name: "振替休日" },
      ]);

      // 2025-05-03 から 2025-05-05（両端を含む）
      const result = await query.findHolidaysBetween("2025-05-03", "2025-05-05");
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual(["2025-05-03", "2025-05-04", "2025-05-05"]);
    });

    it("期間内に祝日がない場合は空配列を返す", async () => {
      const query = createD1HolidayQuery(testDb.db);
      const result = await query.findHolidaysBetween("2025-06-01", "2025-06-30");

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual([]);
    });
  });
});
