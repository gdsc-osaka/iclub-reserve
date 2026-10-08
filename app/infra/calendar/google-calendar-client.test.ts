import { okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";
import { CalendarErrorCode, toCalendarEventId, type CalendarEvent } from "~/domain/calendar";
import { createGoogleCalendarClient } from "./google-calendar-client";

describe("createGoogleCalendarClient", () => {
  const dummyAccessToken = "mock_access_token";
  const getAccessToken = vi.fn().mockReturnValue(okAsync(dummyAccessToken));
  const appEnv = "test-env";

  const sampleEvent: CalendarEvent = {
    calendarId: "calendar_123@group.calendar.google.com",
    eventId: toCalendarEventId("res_sample_01"),
    summary: "第1ミーティングルーム",
    startAt: new Date("2026-10-10T10:00:00Z"),
    endAt: new Date("2026-10-10T12:00:00Z"),
    reservationId: "res_sample_01",
  };

  describe("upsertEvent", () => {
    it("update（PUT）が 200 の場合は成功する", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: sampleEvent.eventId }), {
          status: 200,
        }),
      );

      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.upsertEvent(sampleEvent);
      expect(result.isOk()).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain(encodeURIComponent(sampleEvent.calendarId));
      expect(url).toContain(encodeURIComponent(sampleEvent.eventId));
      expect(init.method).toBe("PUT");
      const body = JSON.parse(init.body);
      expect(body.extendedProperties.private.iclubReserveReservationId).toBe("res_sample_01");
      expect(body.extendedProperties.private.iclubReserveEnv).toBe("test-env");
      expect(body.status).toBe("confirmed");
    });

    it("update が 404 で insert（POST）が 200/201 の場合は新規作成として成功する", async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
        callCount++;
        if (init.method === "PUT") {
          return new Response(JSON.stringify({ error: { code: 404, message: "Not Found" } }), {
            status: 404,
          });
        }
        if (init.method === "POST") {
          return new Response(JSON.stringify({ id: sampleEvent.eventId }), {
            status: 200,
          });
        }
        throw new Error("unexpected method");
      });

      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.upsertEvent(sampleEvent);
      expect(result.isOk()).toBe(true);
      expect(callCount).toBe(2);
      expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
      expect(mockFetch.mock.calls[1][1].method).toBe("POST");
    });

    it("update が 404 で insert が 409（削除済み/重複）の場合は再度 update して成功する", async () => {
      let callIndex = 0;
      const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
        callIndex++;
        if (callIndex === 1) {
          expect(init.method).toBe("PUT");
          return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
        }
        if (callIndex === 2) {
          expect(init.method).toBe("POST");
          return new Response(JSON.stringify({ error: { code: 409 } }), { status: 409 });
        }
        if (callIndex === 3) {
          expect(init.method).toBe("PUT");
          return new Response(JSON.stringify({ id: sampleEvent.eventId }), { status: 200 });
        }
        throw new Error("unexpected call");
      });

      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.upsertEvent(sampleEvent);
      expect(result.isOk()).toBe(true);
      expect(callIndex).toBe(3);
    });
  });

  describe("deleteEvent", () => {
    it("200 / 204 で正常削除できる", async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.deleteEvent("cal_id", "event_id");
      expect(result.isOk()).toBe(true);
      expect(mockFetch.mock.calls[0][1].method).toBe("DELETE");
    });

    it("404（存在しない）および 410（すでに削除済み）は成功として扱う", async () => {
      for (const status of [404, 410]) {
        const mockFetch = vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ error: { code: status } }), { status }));
        const client = createGoogleCalendarClient({
          fetchFn: mockFetch as unknown as typeof fetch,
          getAccessToken,
          appEnv,
        });

        const result = await client.deleteEvent("cal_id", "event_id");
        expect(result.isOk()).toBe(true);
      }
    });

    it("403 Forbidden などのエラーは CalendarError を返す", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ error: { code: 403 } }), { status: 403 }));
      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.deleteEvent("cal_id", "event_id");
      expect(result.isErr()).toBe(true);
    });
  });

  describe("listManagedEvents", () => {
    it("複数ページをたどり、目印のないイベントや ID が一致しないイベントを除外する", async () => {
      const validReservationId1 = "res_valid_1";
      const validEventId1 = toCalendarEventId(validReservationId1);
      const validReservationId2 = "res_valid_2";
      const validEventId2 = toCalendarEventId(validReservationId2);

      const page1Response = {
        nextPageToken: "token_page_2",
        items: [
          // 正常なイベント
          {
            id: validEventId1,
            summary: "第1会議室",
            start: { dateTime: "2026-10-10T10:00:00Z" },
            end: { dateTime: "2026-10-10T12:00:00Z" },
            extendedProperties: {
              private: {
                iclubReserveReservationId: validReservationId1,
                iclubReserveEnv: "test-env",
              },
            },
          },
          // iclubReserveReservationId が無い（手動作成）
          {
            id: "manual_event_1",
            summary: "手動予定",
            start: { dateTime: "2026-10-10T13:00:00Z" },
            end: { dateTime: "2026-10-10T14:00:00Z" },
          },
          // 予定 ID が toCalendarEventId(予約ID) と一致しない（手動複製等）
          {
            id: "copied_event_id",
            summary: "複製された予定",
            start: { dateTime: "2026-10-10T14:00:00Z" },
            end: { dateTime: "2026-10-10T15:00:00Z" },
            extendedProperties: {
              private: {
                iclubReserveReservationId: validReservationId1,
                iclubReserveEnv: "test-env",
              },
            },
          },
        ],
      };

      const page2Response = {
        items: [
          {
            id: validEventId2,
            summary: "第2会議室",
            start: { dateTime: "2026-10-11T09:00:00Z" },
            end: { dateTime: "2026-10-11T11:00:00Z" },
            extendedProperties: {
              private: {
                iclubReserveReservationId: validReservationId2,
                iclubReserveEnv: "test-env",
              },
            },
          },
        ],
      };

      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("pageToken=token_page_2")) {
          return new Response(JSON.stringify(page2Response), { status: 200 });
        }
        return new Response(JSON.stringify(page1Response), { status: 200 });
      });

      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const endAfter = new Date("2026-10-09T00:00:00Z");
      const result = await client.listManagedEvents("cal_id", endAfter);

      expect(result.isOk()).toBe(true);
      const events = result._unsafeUnwrap();
      expect(events).toHaveLength(2);
      expect(events[0].reservationId).toBe(validReservationId1);
      expect(events[1].reservationId).toBe(validReservationId2);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // クエリパラメータの検証
      const firstUrl = mockFetch.mock.calls[0][0];
      expect(firstUrl).toContain("singleEvents=true");
      expect(firstUrl).toContain("showDeleted=false");
      expect(firstUrl).toContain("privateExtendedProperty=iclubReserveEnv%3Dtest-env");
    });
  });

  describe("checkWriteAccess", () => {
    it("accessRole が writer の場合は writable を返す", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accessRole: "writer", items: [] }), {
          status: 200,
        }),
      );
      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.checkWriteAccess("cal_id");
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("writable");
    });

    it("accessRole が owner の場合は writable を返す", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accessRole: "owner", items: [] }), {
          status: 200,
        }),
      );
      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.checkWriteAccess("cal_id");
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("writable");
    });

    it("accessRole が reader の場合は not_writable を返す", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ accessRole: "reader", items: [] }), {
          status: 200,
        }),
      );
      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.checkWriteAccess("cal_id");
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("not_writable");
    });

    it("404 の場合は not_found を返す", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 404 } }), {
          status: 404,
        }),
      );
      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.checkWriteAccess("cal_id");
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("not_found");
    });

    it("レート制限ではない 403 の場合は not_writable を返す", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 403, errors: [{ reason: "forbidden", message: "Forbidden" }] },
          }),
          { status: 403 },
        ),
      );
      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.checkWriteAccess("cal_id");
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("not_writable");
    });

    it("レート制限の 403 はエラーとして返す（確かめられなかったので、書き込めないとは言わない）", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 403, errors: [{ reason: "rateLimitExceeded", message: "Rate Limit" }] },
          }),
          { status: 403 },
        ),
      );
      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken,
        appEnv,
      });

      const result = await client.checkWriteAccess("cal_id");
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr().code).toBe(CalendarErrorCode.RateLimited);
    });
  });

  describe("401 時の token 再取得", () => {
    it("401 が返ったら forceRefresh で token を再取得してリクエストを再試行する", async () => {
      const tokenGetter = vi.fn().mockImplementation((opts) => {
        if (opts?.forceRefresh) {
          return okAsync("refreshed_token");
        }
        return okAsync("expired_token");
      });

      let callIndex = 0;
      const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
        callIndex++;
        const auth = init.headers.get("Authorization");
        if (auth === "Bearer expired_token") {
          return new Response(JSON.stringify({ error: { code: 401 } }), { status: 401 });
        }
        if (auth === "Bearer refreshed_token") {
          return new Response(JSON.stringify({ accessRole: "writer" }), { status: 200 });
        }
        throw new Error("unexpected token");
      });

      const client = createGoogleCalendarClient({
        fetchFn: mockFetch as unknown as typeof fetch,
        getAccessToken: tokenGetter,
        appEnv,
      });

      const result = await client.checkWriteAccess("cal_id");
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("writable");
      expect(tokenGetter).toHaveBeenCalledWith({ forceRefresh: true });
      expect(callIndex).toBe(2);
    });
  });
});
