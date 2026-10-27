import {
  endSlotMinutes,
  startSlotMinutes,
  type SlotRange,
} from "~/components/reservation/editor/reservation-slots";
import {
  parseTokyoDateKey,
  parseTokyoTimeKey,
  tokyoMinutesOfDay,
  toTokyoDateKey,
  toTokyoTimeKey,
} from "~/lib/date";

/**
 * 空き状況カレンダー（SCR-001）が行き来する URL。
 *
 * 施設と週はクエリで持ち回る。組み立て方が散らばると、
 * どちらか片方だけ付け忘れたリンクが混ざるので、必ずここを通す。
 */

/** 仮の枠。日付とその日の時間帯（時刻が未選択なら null） */
export interface CalendarDraft {
  readonly dateKey: string;
  readonly range: SlotRange | null;
}

/** 欄で開いているもの（ADR-014 決定 8・15） */
export type CalendarSelection =
  | { readonly kind: "reservation"; readonly reservationId: string }
  | { readonly kind: "draft"; readonly draft: CalendarDraft }
  | { readonly kind: "edit"; readonly reservationId: string; readonly draft: CalendarDraft };

/** URL から読み取った、欄で開く対象。変更（edit）の仮の枠は URL に無い場合がある */
export type ParsedCalendarSelection =
  | { readonly kind: "reservation"; readonly reservationId: string }
  | { readonly kind: "draft"; readonly draft: CalendarDraft }
  | {
      readonly kind: "edit";
      readonly reservationId: string;
      readonly draft: CalendarDraft | null;
    };

/** 仮の枠を URL パラメータ用の文字列にする（例: 2026-11-04T10:00-11:00、または 2026-11-04） */
export const toDraftParam = (draft: CalendarDraft): string =>
  draft.range === null
    ? draft.dateKey
    : `${draft.dateKey}T${toTokyoTimeKey(draft.range.startMinutes)}-${toTokyoTimeKey(draft.range.endMinutes)}`;

const draftPattern = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})-(\d{2}:\d{2}))?$/;

/**
 * URL の `draft` から仮の枠を読み取る。
 *
 * URL は利用者が書き換えられるので、形が違う・日付として読めない・開始や終了が 30 分の枠に無い・
 * 開始が終了以後、のどれかなら null を返す。日付のみ（YYYY-MM-DD）なら range: null として返す。
 */
export const parseDraftParam = (value: string | null): CalendarDraft | null => {
  if (value === null) return null;
  const match = draftPattern.exec(value);
  if (!match) return null;

  const [, dateKey, startStr, endStr] = match;
  if (parseTokyoDateKey(dateKey) === null) return null;

  // 時刻は、開始と終了が両方あるか両方無いか（正規表現で 1 組にしている）。無ければ時刻を選んでいない仮の枠
  if (startStr === undefined || endStr === undefined) return { dateKey, range: null };

  const startMinutes = parseTokyoTimeKey(startStr);
  const endMinutes = parseTokyoTimeKey(endStr);
  if (startMinutes === null || endMinutes === null) return null;

  if (!startSlotMinutes.includes(startMinutes)) return null;
  if (!endSlotMinutes.includes(endMinutes)) return null;
  if (startMinutes >= endMinutes) return null;

  return { dateKey, range: { startMinutes, endMinutes } };
};

/**
 * URL のクエリから、欄で開く対象を取り出す。
 *
 * edit（空でない文字列）があれば変更、無ければ reservation（空でない文字列）があれば予約、無ければ draft を読む。
 * edit があるときは、draft を変更後の日時として読む（ADR-014 決定 15）。
 */
export const parseCalendarSelection = (
  searchParams: URLSearchParams,
): ParsedCalendarSelection | null => {
  const editId = searchParams.get("edit")?.trim();
  if (editId) {
    const draft = parseDraftParam(searchParams.get("draft"));
    return { kind: "edit", reservationId: editId, draft };
  }

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

/** 予約の開始・終了日時から仮の枠を作る（ADR-014 決定 15） */
export const toReservationDraft = ({
  startAt,
  endAt,
}: {
  readonly startAt: Date;
  readonly endAt: Date;
}): CalendarDraft => ({
  dateKey: toTokyoDateKey(startAt),
  range: {
    startMinutes: tokyoMinutesOfDay(startAt),
    endMinutes: tokyoMinutesOfDay(endAt),
  },
});

/**
 * この画面の URL を組み立てる。施設と基準の日を両方持ち回るので、リンクは必ずここを通す。
 *
 * `facilityId` が null のときは `facility=` を付けない（一覧の先頭の施設を出す）。
 * `selection` を渡すと、欄で開くもの（`reservation`・`draft`・`edit`）を後ろに付ける。
 * 仮の枠の値は数字・`-`・`T`・`:` だけなので、アドレス欄で読めるよう encodeURIComponent しない。
 */
export const toCalendarPath = (
  facilityId: string | null,
  dateKey: string,
  selection?: CalendarSelection,
): string => {
  const facility = facilityId === null ? "" : `facility=${encodeURIComponent(facilityId)}&`;
  const base = `/availability?${facility}date=${dateKey}`;
  if (selection === undefined) return base;
  if (selection.kind === "reservation") {
    return `${base}&reservation=${encodeURIComponent(selection.reservationId)}`;
  }
  if (selection.kind === "draft") {
    return `${base}&draft=${toDraftParam(selection.draft)}`;
  }
  return `${base}&edit=${encodeURIComponent(selection.reservationId)}&draft=${toDraftParam(selection.draft)}`;
};

/** 欄で開いているもの（`reservation`・`draft`・`edit`）を除いたクエリ。並びの違いは無視する */
const withoutSelection = (params: URLSearchParams): string => {
  const rest = new URLSearchParams(params);
  rest.delete("reservation");
  rest.delete("draft");
  rest.delete("edit");
  rest.sort();
  return rest.toString();
};

/**
 * 2 つのクエリの違いが、欄で開いているもの（`reservation`・`draft`・`edit`）だけか（ADR-014 決定 8・16）。
 *
 * 施設（`facility`）や基準の日（`date`）が違えば、読むデータが変わるので false。
 */
export const differsOnlyInSelection = (a: URLSearchParams, b: URLSearchParams): boolean =>
  withoutSelection(a) === withoutSelection(b);

/**
 * 変更の欄を開いた、または別の予約の変更に替えたか（ADR-014 決定 16）。
 *
 * 読んだ結果が変更で、前と予約 ID が違う（前の選択が変更でない、または前と予約 ID が異なる）場合に true を返す。
 * shouldRevalidate でローダーを実行し直す判定に使う。
 */
export const isEditReservationChanged = (
  prevParams: URLSearchParams,
  nextParams: URLSearchParams,
): boolean => {
  const next = parseCalendarSelection(nextParams);
  if (next?.kind !== "edit") return false;
  const prev = parseCalendarSelection(prevParams);
  return prev?.kind !== "edit" || prev.reservationId !== next.reservationId;
};

/**
 * 送信後の転送先などで使う基準の日（URL の `date`）を決める。
 *
 * 送ってきた URL の `date` が日付として読めればそれ、読めなければフォールバックの日を使う。
 */
export const resolveAnchorDateKey = (requestUrl: string | URL, fallbackDateKey: string): string => {
  const url = typeof requestUrl === "string" ? new URL(requestUrl) : requestUrl;
  const dateParam = url.searchParams.get("date");
  return dateParam !== null && parseTokyoDateKey(dateParam) !== null ? dateParam : fallbackDateKey;
};
