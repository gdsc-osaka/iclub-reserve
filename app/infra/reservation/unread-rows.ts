import { UNREAD_ITEMS_LIMIT } from "~/domain/reservation";

/** 未読の出来事 1 件。どの予約で、いつ起きたか */
interface UnreadEvent {
  readonly reservationId: string;
  readonly eventAt: Date;
}

/** 予約 1 件につき 1 行にまとめた未読の一覧 */
export interface UnreadRows<Row> {
  /** 新しい順に最大 10 件 */
  readonly items: readonly Row[];
  /** 10 件を超えた予約の数 */
  readonly overflowCount: number;
  /** 未読のある予約すべての ID（10 件を超えた分も含む） */
  readonly allUnreadReservationIds: readonly string[];
}

/**
 * 未読の出来事を、予約 1 件につき 1 行にまとめる（COND-026 (1)・(6)）。
 *
 * 行には、その予約の未読のうち最新の出来事を代表として渡し、ほかの未読の数を添える。
 * 行は代表の出来事が新しい順に並べ、最大 10 件まで出す。
 * 団体側（`group-unread-updates-query.ts`）と事務局側（`app/query/reservation/staff-unread-messages.ts`）で、
 * 何を出来事とみなすかは違うが、まとめ方は同じなのでここに置く。
 */
export const toUnreadRows = <Event extends UnreadEvent, Row>(
  events: readonly Event[],
  toRow: (latest: Event, otherCount: number) => Row,
): UnreadRows<Row> => {
  const latestFirst = (a: Event, b: Event) => b.eventAt.getTime() - a.eventAt.getTime();

  const eventsByReservation = new Map<string, Event[]>();
  for (const event of events) {
    const list = eventsByReservation.get(event.reservationId) ?? [];
    list.push(event);
    eventsByReservation.set(event.reservationId, list);
  }

  // 予約ごとに最新の出来事を代表に選び、代表の新しい順に並べる
  const groups = [...eventsByReservation.values()]
    .map((list) => {
      // Map に入れた時点で 1 件以上あるので、先頭は必ずある
      const [latest, ...others] = [...list].sort(latestFirst) as [Event, ...Event[]];
      return { latest, otherCount: others.length };
    })
    .sort((a, b) => latestFirst(a.latest, b.latest));

  return {
    items: groups
      .slice(0, UNREAD_ITEMS_LIMIT)
      .map(({ latest, otherCount }) => toRow(latest, otherCount)),
    overflowCount: Math.max(0, groups.length - UNREAD_ITEMS_LIMIT),
    allUnreadReservationIds: groups.map(({ latest }) => latest.reservationId),
  };
};
