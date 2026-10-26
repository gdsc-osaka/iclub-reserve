import {
  endSlotMinutes,
  startSlotMinutes,
  type SlotRange,
} from "~/components/reservation/editor/reservation-slots";
import { parseTokyoDateKey, parseTokyoTimeKey, toTokyoTimeKey } from "~/lib/date";

/**
 * 空き状況カレンダー（SCR-001）が行き来する URL。
 *
 * 施設と週はクエリで持ち回る。組み立て方が散らばると、
 * どちらか片方だけ付け忘れたリンクが混ざるので、必ずここを通す。
 */

/** 仮の枠。日付とその日の時間帯 */
export interface CalendarDraft {
  readonly dateKey: string;
  readonly range: SlotRange;
}

/** 欄で開いているもの */
export type CalendarSelection =
  | { readonly kind: "reservation"; readonly reservationId: string }
  | { readonly kind: "draft"; readonly draft: CalendarDraft };

/** 仮の枠を URL パラメータ用の文字列にする（例: 2026-11-04T10:00-11:00） */
export const toDraftParam = (draft: CalendarDraft): string =>
  `${draft.dateKey}T${toTokyoTimeKey(draft.range.startMinutes)}-${toTokyoTimeKey(draft.range.endMinutes)}`;

const draftPattern = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})-(\d{2}:\d{2})$/;

/**
 * URL の `draft` から仮の枠を読み取る。
 *
 * URL は利用者が書き換えられるので、形が違う・日付として読めない・開始や終了が 30 分の枠に無い・
 * 開始が終了以後、のどれかなら null を返す。
 */
export const parseDraftParam = (value: string | null): CalendarDraft | null => {
  if (value === null) return null;
  const match = draftPattern.exec(value);
  if (!match) return null;

  const [, dateKey, startStr, endStr] = match;
  if (parseTokyoDateKey(dateKey) === null) return null;

  const startMinutes = parseTokyoTimeKey(startStr);
  const endMinutes = parseTokyoTimeKey(endStr);
  if (startMinutes === null || endMinutes === null) return null;

  if (!startSlotMinutes.includes(startMinutes)) return null;
  if (!endSlotMinutes.includes(endMinutes)) return null;
  if (startMinutes >= endMinutes) return null;

  return { dateKey, range: { startMinutes, endMinutes } };
};

/**
 * URL のクエリから、欄で開く対象（予約または仮の枠）を取り出す。
 *
 * reservation（空でない文字列）があれば予約、無ければ draft を読む。
 * 両方ある場合は予約を優先する（どちらか 1 つしか開かないため）。
 */
export const parseCalendarSelection = (searchParams: URLSearchParams): CalendarSelection | null => {
  const reservationId = searchParams.get("reservation")?.trim();
  if (reservationId) {
    return { kind: "reservation", reservationId };
  }

  const draft = parseDraftParam(searchParams.get("draft"));
  if (draft !== null) {
    return { kind: "draft", draft };
  }

  return null;
};

/**
 * この画面の URL を組み立てる。施設と基準の日を両方持ち回るので、リンクは必ずここを通す。
 *
 * `selection` を渡すと、欄で開くもの（`reservation` か `draft`）を後ろに付ける。
 * 仮の枠の値は数字・`-`・`T`・`:` だけなので、アドレス欄で読めるよう encodeURIComponent しない。
 */
export const toCalendarPath = (
  facilityId: string,
  dateKey: string,
  selection?: CalendarSelection,
): string => {
  const base = `/availability?facility=${encodeURIComponent(facilityId)}&date=${dateKey}`;
  if (selection === undefined) return base;
  return selection.kind === "reservation"
    ? `${base}&reservation=${encodeURIComponent(selection.reservationId)}`
    : `${base}&draft=${toDraftParam(selection.draft)}`;
};

/** 欄で開いているもの（`reservation`・`draft`）を除いたクエリ。並びの違いは無視する */
const withoutSelection = (params: URLSearchParams): string => {
  const rest = new URLSearchParams(params);
  rest.delete("reservation");
  rest.delete("draft");
  rest.sort();
  return rest.toString();
};

/**
 * 2 つのクエリの違いが、欄で開いているもの（`reservation`・`draft`）だけか（ADR-014 決定 8）。
 *
 * 施設（`facility`）や基準の日（`date`）が違えば、読むデータが変わるので false。
 */
export const differsOnlyInSelection = (a: URLSearchParams, b: URLSearchParams): boolean =>
  withoutSelection(a) === withoutSelection(b);
