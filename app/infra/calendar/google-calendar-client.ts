import { errAsync, okAsync, ResultAsync } from "neverthrow";
import {
  CalendarErrorCode,
  toCalendarEventId,
  type CalendarClient,
  type CalendarError,
  type CalendarEvent,
  type CalendarWriteAccess,
  type ManagedCalendarEvent,
} from "~/domain/calendar";
import { classifyGoogleCalendarError } from "./google-calendar-error";

export interface GoogleCalendarClientOptions {
  readonly fetchFn?: typeof fetch;
  readonly getAccessToken: (options?: {
    forceRefresh?: boolean;
  }) => ResultAsync<string, CalendarError>;
  readonly appEnv: string;
}

const CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

/** Google Calendar のイベントレスポンス形式 */
interface GoogleEventApiResponse {
  readonly id?: string;
  readonly summary?: string;
  readonly status?: string;
  readonly start?: {
    readonly dateTime?: string;
    readonly date?: string;
    readonly timeZone?: string;
  };
  readonly end?: {
    readonly dateTime?: string;
    readonly date?: string;
    readonly timeZone?: string;
  };
  readonly extendedProperties?: {
    readonly private?: {
      readonly iclubReserveReservationId?: string;
      readonly iclubReserveEnv?: string;
      readonly [key: string]: string | undefined;
    };
  };
}

/** Google Calendar のイベント一覧レスポンス形式 */
interface GoogleEventsListApiResponse {
  readonly accessRole?: string;
  readonly nextPageToken?: string;
  readonly items?: readonly GoogleEventApiResponse[];
}

/**
 * Google Calendar API を呼び出す CalendarClient の実装を作成する。
 *
 * @param options.fetchFn HTTP リクエスト用 fetch（テストで差し替え可能）
 * @param options.getAccessToken Service Account のアクセストークン取得関数
 * @param options.appEnv 実行環境（local / preview / production）。予定の目印（extendedProperties）に付与
 */
export const createGoogleCalendarClient = ({
  fetchFn = fetch,
  getAccessToken,
  appEnv,
}: GoogleCalendarClientOptions): CalendarClient => {
  /**
   * 認証付きで Google Calendar API を呼び出す内部ヘルパー。
   *
   * 401 が返った場合は保持していた token を捨てて 1 回だけ取り直して再試行する。
   */
  const requestWithAuth = (
    url: string,
    init: RequestInit,
  ): ResultAsync<{ status: number; body: unknown }, CalendarError> => {
    const execute = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);

      return ResultAsync.fromPromise(fetchFn(url, { ...init, headers }), (err) =>
        classifyGoogleCalendarError(0, null, err),
      ).andThen((response) =>
        ResultAsync.fromPromise(
          response.text().then((text) => ({ status: response.status, text })),
          (err) => classifyGoogleCalendarError(0, null, err),
        ).map(({ status, text }) => {
          let body: unknown;
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
          return { status, body };
        }),
      );
    };

    return getAccessToken().andThen((token) =>
      execute(token).andThen((res) => {
        // 401 の場合は token を破棄して 1 回だけ再試行
        if (res.status === 401) {
          return getAccessToken({ forceRefresh: true }).andThen((newToken) => execute(newToken));
        }
        return okAsync(res);
      }),
    );
  };

  return {
    upsertEvent(event: CalendarEvent): ResultAsync<null, CalendarError> {
      const eventPayload = {
        id: event.eventId,
        summary: event.summary,
        status: "confirmed",
        start: {
          dateTime: event.startAt.toISOString(),
          timeZone: "Asia/Tokyo",
        },
        end: {
          dateTime: event.endAt.toISOString(),
          timeZone: "Asia/Tokyo",
        },
        extendedProperties: {
          private: {
            iclubReserveReservationId: event.reservationId,
            iclubReserveEnv: appEnv,
          },
        },
      };

      const updateUrl = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(event.calendarId)}/events/${encodeURIComponent(event.eventId)}`;
      const insertUrl = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(event.calendarId)}/events`;

      const sendUpdate = () =>
        requestWithAuth(updateUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eventPayload),
        });

      const sendInsert = () =>
        requestWithAuth(insertUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(eventPayload),
        });

      // 1. まず update (PUT) を試みる
      return sendUpdate().andThen((updateRes) => {
        if (updateRes.status === 200) {
          return okAsync(null);
        }

        // 2. 404 の場合は新規作成 (POST) を試みる
        if (updateRes.status === 404) {
          return sendInsert().andThen((insertRes) => {
            if (insertRes.status === 200 || insertRes.status === 201) {
              return okAsync(null);
            }

            // 3. insert が 409（すでに存在・削除済みで ID が残っている）なら再度 update
            if (insertRes.status === 409) {
              return sendUpdate().andThen((retryUpdateRes) => {
                if (retryUpdateRes.status === 200) {
                  return okAsync(null);
                }
                return errAsync(
                  classifyGoogleCalendarError(retryUpdateRes.status, retryUpdateRes.body),
                );
              });
            }

            return errAsync(classifyGoogleCalendarError(insertRes.status, insertRes.body));
          });
        }

        return errAsync(classifyGoogleCalendarError(updateRes.status, updateRes.body));
      });
    },

    deleteEvent(calendarId: string, eventId: string): ResultAsync<null, CalendarError> {
      const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

      return requestWithAuth(url, {
        method: "DELETE",
      }).andThen((res) => {
        // 成功（200, 204）またはすでに削除済み（404, 410）は成功として扱う
        if (res.status === 200 || res.status === 204 || res.status === 404 || res.status === 410) {
          return okAsync(null);
        }

        return errAsync(classifyGoogleCalendarError(res.status, res.body));
      });
    },

    listManagedEvents(
      calendarId: string,
      endAfter: Date,
    ): ResultAsync<ManagedCalendarEvent[], CalendarError> {
      const managedEvents: ManagedCalendarEvent[] = [];

      const fetchPage = (pageToken?: string): ResultAsync<void, CalendarError> => {
        const query = new URLSearchParams({
          timeMin: endAfter.toISOString(),
          singleEvents: "true",
          showDeleted: "false",
          privateExtendedProperty: `iclubReserveEnv=${appEnv}`,
          maxResults: "250",
        });
        if (pageToken) {
          query.set("pageToken", pageToken);
        }

        const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${query.toString()}`;

        return requestWithAuth(url, {
          method: "GET",
        }).andThen((res) => {
          if (res.status !== 200) {
            return errAsync(classifyGoogleCalendarError(res.status, res.body));
          }

          const data = res.body as GoogleEventsListApiResponse;
          const items = data.items ?? [];

          for (const item of items) {
            if (!item.id) continue;

            const reservationId = item.extendedProperties?.private?.iclubReserveReservationId;
            // iclubReserveReservationId が無いものは除外
            if (!reservationId) continue;

            // 予定 ID が toCalendarEventId(その予約 ID) と一致しないものは除外（人が手で足した・複製した予定を保護）
            if (item.id !== toCalendarEventId(reservationId)) continue;

            const startStr = item.start?.dateTime ?? item.start?.date;
            const endStr = item.end?.dateTime ?? item.end?.date;
            if (!startStr || !endStr) continue;

            const startAt = new Date(startStr);
            const endAt = new Date(endStr);
            if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) continue;

            managedEvents.push({
              eventId: item.id,
              reservationId,
              summary: item.summary ?? "",
              startAt,
              endAt,
            });
          }

          if (data.nextPageToken) {
            return fetchPage(data.nextPageToken);
          }

          return okAsync(undefined);
        });
      };

      return fetchPage().map(() => managedEvents);
    },

    checkWriteAccess(calendarId: string): ResultAsync<CalendarWriteAccess, CalendarError> {
      const url = `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?maxResults=1`;

      return requestWithAuth(url, {
        method: "GET",
      }).andThen((res) => {
        if (res.status === 404) {
          return okAsync<CalendarWriteAccess, CalendarError>("not_found");
        }

        if (res.status === 200) {
          const data = res.body as GoogleEventsListApiResponse;
          const accessRole = data.accessRole;
          if (accessRole === "writer" || accessRole === "owner") {
            return okAsync<CalendarWriteAccess, CalendarError>("writable");
          }
          return okAsync<CalendarWriteAccess, CalendarError>("not_writable");
        }

        const error = classifyGoogleCalendarError(res.status, res.body);
        // レート制限ではない 403 は、カレンダーを読む権限すら無いということ。
        // 共有の設定を直せば通るので、エラーではなく「書き込めない」として返す
        if (error.code === CalendarErrorCode.Forbidden) {
          return okAsync<CalendarWriteAccess, CalendarError>("not_writable");
        }
        return errAsync<CalendarWriteAccess, CalendarError>(error);
      });
    },
  };
};
