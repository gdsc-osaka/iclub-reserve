import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigation } from "react-router";

import {
  OPEN_MINUTES,
  toAxisPercent,
  type AvailabilityDay,
} from "~/components/reservation/availability-week";
import type { SlotRange } from "~/components/reservation/editor/reservation-slots";
import { addDays, toTokyoDateKey } from "~/lib/date";

import {
  findDayIndex,
  formatVisibleMonths,
  needsWindowShift,
  toAlignedIndex,
  toRevealIndex,
  toVisibleCount,
} from "./calendar-window";

/**
 * スクロールが止まったとみなすまでの時間。
 *
 * `scrollend` は Safari で使えないので、`scroll` が途切れるのを待つ。
 */
const SCROLL_SETTLE_MS = 150;

/**
 * 箱の中を測る。押したとき・スクロールが止まったとき・幅が変わったときにだけ呼び、描画の中では測らない。
 *
 * 列の幅は、隠れていない最初の列で測る。整う前は前の週の列を隠していて、その幅は 0 になる。
 */
const measure = (container: HTMLElement) => {
  const columns = container.querySelectorAll<HTMLElement>("[data-slot='day-column']");
  const column = Array.from(columns).find((element) => element.offsetWidth > 0);
  const columnWidth = column?.getBoundingClientRect().width ?? 0;
  const axisWidth =
    container.querySelector("[data-slot='hour-axis']")?.getBoundingClientRect().width ?? 0;

  return {
    columnWidth,
    visibleCount: toVisibleCount(container.clientWidth - axisWidth, columnWidth),
    firstIndex: columnWidth > 0 ? Math.round(container.scrollLeft / columnWidth) : 0,
  };
};

/**
 * 時間帯を縦に見せるための、箱の `scrollTop`。もう見えていれば今の `scrollTop` のまま。
 *
 * 時間帯が日付の見出し（sticky）の下から箱の下端までに収まっていなければ、
 * 上端が見出しのすぐ下に来るようにする。日の列が見つからなければ null。
 */
const toRevealScrollTop = (
  container: HTMLElement,
  dateKey: string,
  range: SlotRange,
): number | null => {
  const column = container.querySelector(`[data-date-key="${dateKey}"]`);
  const heading = column?.querySelector("[data-slot='day-heading']")?.getBoundingClientRect();
  const body = column?.querySelector("[data-slot='day-body']")?.getBoundingClientRect();
  if (heading === undefined || body === undefined) return null;

  // 時刻の位置は、本体の高さに対する割合で決まっている（帯や仮の枠と同じ計算）
  const toY = (at: number) => body.top + (body.height * toAxisPercent(at - OPEN_MINUTES)) / 100;
  const y = toY(range.startMinutes);
  const shownTop = heading.bottom;
  const shownBottom = container.getBoundingClientRect().top + container.clientHeight;
  // 時間帯がまるごと（箱より長ければ箱の高さぶん）見えていれば送らない。上端だけで見ると、下端で切れたまま残る
  const height = Math.min(toY(range.endMinutes) - y, shownBottom - shownTop);
  const isShown = y >= shownTop && y + height <= shownBottom;

  return isShown ? container.scrollTop : container.scrollTop + (y - shownTop);
};

/**
 * カレンダーの横の位置を扱う（ADR-014 決定 3〜5）。
 *
 * 止まる位置は CSS の scroll-snap が決めるので、ここでは行き先を決めて `scrollTo` するだけにする。
 * `scrollBy` は使わない。Chrome は向きのあるスクロールとして扱い、`scroll-snap-stop: always` のせいで
 * 次の 1 列で止まってしまう。
 *
 * 端に近づいたら基準の日を変えて 4 週間を読み直し、読み直した後に同じ日へ合わせ直す。
 * 返す `containerRef` は、カレンダーのスクロールする箱に付ける。
 */
export function useCalendarScroll({
  days,
  anchorKey,
  todayKey,
}: Readonly<{
  days: readonly AvailabilityDay[];
  /** 基準の日（URL の `date`） */
  anchorKey: string;
  todayKey: string;
}>) {
  const navigate = useNavigate();
  const location = useLocation();
  const isNavigating = useNavigation().state !== "idle";

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);
  /** 見えている先頭の日と表示日数。見出しの年月に使う。整う前は null */
  const [view, setView] = useState<{ firstIndex: number; visibleCount: number } | null>(null);

  /**
   * 最後に止まったときの先頭の日。幅が変わったら、この日を保つ位置へ合わせ直す。
   * 幅が変わった時点の `scrollLeft` は、ブラウザが止まる位置を選び直した後の値のことがあるので使わない。
   */
  const settledIndexRef = useRef(0);
  /** なめらかに送っている途中の行き先。続けて押したとき、途中の位置ではなく行き先から数える */
  const targetIndexRef = useRef<number | null>(null);
  /** 読み直した後に先頭へ合わせる日 */
  const pendingAlignKeyRef = useRef<string | null>(null);
  /** 最後に合わせたときの箱の幅。高さだけが変わったときは合わせ直さない */
  const widthRef = useRef(0);

  const settle = (firstIndex: number, visibleCount: number) => {
    settledIndexRef.current = firstIndex;
    targetIndexRef.current = null;
    setView({ firstIndex, visibleCount });
  };

  /** 先頭を `index` の日にする。7 日の表示では、その週の日曜にする */
  const scrollToIndex = (index: number, behavior: "instant" | "smooth") => {
    const container = containerRef.current;
    if (container === null) return;
    const { columnWidth, visibleCount } = measure(container);
    if (columnWidth <= 0) return;

    const aligned = toAlignedIndex(days, index, visibleCount);
    container.scrollTo({ left: aligned * columnWidth, behavior });
    widthRef.current = container.clientWidth;
    if (behavior === "instant") settle(aligned, visibleCount);
    else targetIndexRef.current = aligned;
  };

  /**
   * 基準の日を変えて 4 週間を読み直す（ADR-014 決定 4）。
   *
   * URL の `date` だけを書き換え、施設・開いているもの・`location.state` は残す。
   * 読み直しは横に送ることの続きなので、履歴には積まない。
   */
  const reload = (alignKey: string) => {
    pendingAlignKeyRef.current = alignKey;
    const searchParams = new URLSearchParams(location.search);
    searchParams.set("date", alignKey);
    void navigate(
      { search: `?${searchParams.toString()}` },
      { replace: true, preventScrollReset: true, state: location.state },
    );
  };

  /** その日を先頭にする。読み込んだ 4 週間に無ければ、その日を基準の日にして読み直す */
  const goToDate = (dateKey: string) => {
    const index = findDayIndex(days, dateKey);
    if (index === -1) reload(dateKey);
    else scrollToIndex(index, "smooth");
  };

  /** 表示日数ぶん前後へ送る。行き先が読み込んだ 4 週間を越えるなら、行き先の日を基準の日にして読み直す */
  const goBy = (direction: -1 | 1) => {
    const container = containerRef.current;
    if (container === null) return;
    const { columnWidth, visibleCount, firstIndex } = measure(container);
    if (columnWidth <= 0) return;

    const from = targetIndexRef.current ?? firstIndex;
    const to = from + direction * visibleCount;
    if (to >= 0 && to + visibleCount <= days.length) {
      scrollToIndex(to, "smooth");
      return;
    }

    const fromDay = days[from];
    if (fromDay !== undefined) {
      reload(toTokyoDateKey(addDays(fromDay.date, direction * visibleCount)));
    }
  };

  /*
   * 最初に描くとき（ADR-014 決定 5）。サーバーで描く時点では横の位置を決められないので、
   * 基準より前の列を隠して描いてある。描画の前に列を出し、基準の日（7 日の表示ではその週の日曜）を先頭にする。
   */
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    // 測る前に列を出す。React の描画を待つと、列を出してから位置を合わせるまでの間が画面に映る
    container.dataset.ready = "true";
    scrollToIndex(findDayIndex(days, anchorKey), "instant");
    setIsReady(true);
    // 最初の 1 回だけ。読み直した後は下の effect が合わせる
  }, []);

  /*
   * 読み直した後（先頭の日付が変わったとき）。列は日付をキーにしているので同じ DOM が使い回されるが、
   * 前に列が増えたぶん横にずれる。描画の前に、合わせる日へ戻す。
   * 戻る・進むで別の基準の日へ移ったときは、合わせる日が無いので基準の日へ合わせる。
   */
  const firstDayKey = days[0]?.dateKey;
  const alignedFirstDayKeyRef = useRef(firstDayKey);
  useLayoutEffect(() => {
    if (alignedFirstDayKeyRef.current === firstDayKey) return;
    alignedFirstDayKeyRef.current = firstDayKey;
    scrollToIndex(findDayIndex(days, pendingAlignKeyRef.current ?? anchorKey), "instant");
    pendingAlignKeyRef.current = null;
  }, [firstDayKey]);

  /**
   * 端に近づいていれば、先頭の日を基準の日にして読み直す。
   *
   * ほかの遷移の途中・なめらかに送っている途中は見送る。読み直しが重なると、合わせる日が入れ替わる。
   * 見送ったぶんは、遷移が終わったときと、スクロールが止まったときに確かめ直す。
   */
  const reloadIfNearEdge = () => {
    const container = containerRef.current;
    if (container === null || isNavigating || targetIndexRef.current !== null) return;
    const { columnWidth, visibleCount, firstIndex } = measure(container);
    if (columnWidth <= 0 || !needsWindowShift(firstIndex, visibleCount, days.length)) return;
    const firstDay = days[firstIndex];
    if (firstDay !== undefined) reload(firstDay.dateKey);
  };

  /** スクロールが止まったとき。先頭の日を覚え、端に近づいていれば読み直す */
  const handleSettled = () => {
    const container = containerRef.current;
    if (container === null) return;
    const { columnWidth, visibleCount, firstIndex } = measure(container);
    if (columnWidth <= 0) return;
    settle(firstIndex, visibleCount);
    reloadIfNearEdge();
  };

  /**
   * 箱の幅が変わったとき。表示日数や列の幅が変わるので、止まっていた先頭の日を保つ位置へ合わせ直す。
   *
   * スマホで欄を広げている間は、カレンダーを隠す（ADR-014 決定 13）。Safari は隠した箱の横の位置を 0 に戻すので、
   * 隠れた（幅が 0 になった）ことを覚えておき、また出たときに合わせ直す。覚えておかないと、出たときの幅が
   * 隠す前と同じなので合わせ直さず、4 週間の先頭に戻ったまま、端に近づいたとみなして読み直してしまう。
   */
  const handleResize = () => {
    const container = containerRef.current;
    if (container === null || container.clientWidth === widthRef.current) return;
    if (container.clientWidth === 0) {
      widthRef.current = 0;
      return;
    }
    scrollToIndex(targetIndexRef.current ?? settledIndexRef.current, "instant");
  };

  /*
   * scroll と ResizeObserver は 1 度だけ登録し、中では最新の処理を呼ぶ。
   * 描画のたびに登録し直すと、止まるのを待っている間の timer が消えてしまう。
   */
  const handlersRef = useRef({ handleSettled, handleResize, reloadIfNearEdge });
  useLayoutEffect(() => {
    handlersRef.current = { handleSettled, handleResize, reloadIfNearEdge };
  });

  // 遷移の途中に止まったときは読み直しを見送っているので、遷移が終わったら確かめ直す
  useEffect(() => {
    if (isReady && !isNavigating) handlersRef.current.reloadIfNearEdge();
  }, [isReady, isNavigating]);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => handlersRef.current.handleSettled(), SCROLL_SETTLE_MS);
    };
    const observer = new ResizeObserver(() => handlersRef.current.handleResize());

    container.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      container.removeEventListener("scroll", onScroll);
      observer.disconnect();
    };
  }, [containerRef]);

  /**
   * その日と時刻を、見える範囲に入れる。欄で開いたもの（予約の帯・仮の枠）を見せるのに使う。
   *
   * 横は、もう見えていれば動かさない（{@link toRevealIndex}）。
   * 縦は {@link toRevealScrollTop} で決める。時間帯が null（時刻を選んでいない仮の枠）なら縦は動かさない。
   * 欄が開くと箱の幅と高さが変わるので、1 フレーム待ってから測る（幅の合わせ直しが先に済む）。
   */
  const reveal = (dateKey: string, range: SlotRange | null) => {
    requestAnimationFrame(() => {
      const container = containerRef.current;
      const index = findDayIndex(days, dateKey);
      if (container === null || index === -1) return;
      const { columnWidth, visibleCount, firstIndex } = measure(container);
      if (columnWidth <= 0) return;

      const from = targetIndexRef.current ?? firstIndex;
      const to = toRevealIndex(days, index, from, visibleCount);
      const top =
        range === null ? container.scrollTop : toRevealScrollTop(container, dateKey, range);
      if (top === null) return;

      if (to === from && top === container.scrollTop) return;
      container.scrollTo({ left: to * columnWidth, top, behavior: "smooth" });
      targetIndexRef.current = to;
    });
  };

  // 整う前は、基準の日の年月を出す
  const anchorIndex = findDayIndex(days, anchorKey);
  const firstDay = days[view?.firstIndex ?? anchorIndex];
  const lastDay =
    view === null
      ? firstDay
      : days[Math.min(days.length - 1, view.firstIndex + view.visibleCount - 1)];
  const visibleMonths =
    firstDay !== undefined && lastDay !== undefined
      ? formatVisibleMonths(firstDay.date, lastDay.date)
      : "";

  return {
    containerRef,
    isReady,
    visibleMonths,
    goToPrevious: () => goBy(-1),
    goToNext: () => goBy(1),
    goToToday: () => goToDate(todayKey),
    goToDate,
    reveal,
  };
}

/** カレンダーの横の位置と、それを動かす操作。カードに渡す */
export type CalendarScroll = ReturnType<typeof useCalendarScroll>;
