import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigation } from "react-router";

import {
  OPEN_MINUTES,
  toAxisPercent,
  type AvailabilityDay,
} from "~/components/reservation/availability-week";
import type { SlotRange } from "~/components/reservation/editor/reservation-slots";
import { addDays, parseTokyoDateKey, toTokyoDateKey, tokyoDaysUntil } from "~/lib/date";

import {
  findDayIndex,
  formatVisibleMonths,
  needsWindowShift,
  toAlignedIndex,
  toRevealIndex,
  toSwipeTargetIndex,
  toVisibleCount,
} from "./calendar-window";

/**
 * スクロールが止まったとみなすまでの時間。
 *
 * `scrollend` は Safari で使えないので、`scroll` が途切れるのを待つ。
 */
const SCROLL_SETTLE_MS = 150;

/** 指の操作を「横に送る操作」と決めるまでの最小移動量（px） */
const SWIPE_LOCK_THRESHOLD_PX = 8;

/** 離す直前の横方向の速さを測る時間の窓（ms） */
const SWIPE_VELOCITY_WINDOW_MS = 120;

type SwipeSample = Readonly<{ x: number; time: number }>;

type TouchSwipeState =
  | {
      readonly phase: "pending";
      readonly pointerId: number;
      readonly startX: number;
      readonly startY: number;
      readonly startScrollLeft: number;
      readonly samples: SwipeSample[];
    }
  | {
      readonly phase: "horizontal";
      readonly pointerId: number;
      readonly startX: number;
      readonly startScrollLeft: number;
      readonly samples: SwipeSample[];
    };

/** 離す直前の横方向の `scrollLeft` の速さ（px / ms）を求める。指を左へ払う（`scrollLeft` が増える）向きが正 */
const measureScrollVelocity = (
  samples: readonly SwipeSample[],
  endX: number,
  endTime: number,
): number => {
  const cutoff = endTime - SWIPE_VELOCITY_WINDOW_MS;
  const base = samples.find((sample) => sample.time >= cutoff);
  if (base === undefined) return 0;
  const dt = endTime - base.time;
  if (dt <= 0) return 0;
  return -(endX - base.x) / dt;
};

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
 * 指による横スクロールだけは JavaScript で受け持つ（ADR-014 決定 21）。2 方向にスクロールする箱の向きを固定する CSS が無く、
 * `touch-action` は押し始めで決まり途中で変えられないため、箱には `touch-pan-y touch-pinch-zoom` を付けて
 * 縦スクロールと拡大だけをブラウザに任せ、横は押し始めからの向きを見て動かす。マウス・トラックパッド・ペンはブラウザのまま。
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
   * カレンダーを隠したまま開いたとき（幅 0）でも、出たときに基準の日へ合わせられるよう基準の日の位置で始める。
   */
  const settledIndexRef = useRef(Math.max(0, findDayIndex(days, anchorKey)));
  /** なめらかに送っている途中の行き先。続けて押したとき、途中の位置ではなく行き先から数える */
  const targetIndexRef = useRef<number | null>(null);
  /** 読み直した後に先頭へ合わせる日 */
  const pendingAlignKeyRef = useRef<string | null>(null);
  /** 最後に合わせたときの箱の幅。高さだけが変わったときは合わせ直さない */
  const widthRef = useRef(0);
  /** 指による横スクロールの途中の状態 */
  const swipeRef = useRef<TouchSwipeState | null>(null);
  /** 横に送る操作の直後の click を 1 回だけ捨てるための印 */
  const swipedRef = useRef(false);

  const settle = (firstIndex: number, visibleCount: number) => {
    if (containerRef.current !== null) containerRef.current.style.scrollSnapType = "";
    settledIndexRef.current = firstIndex;
    targetIndexRef.current = null;
    setView({ firstIndex, visibleCount });
  };

  /** 先頭を `index` の日にする。7 日の表示では、その週の日曜にする */
  const scrollToIndex = (index: number, behavior: "instant" | "smooth") => {
    const container = containerRef.current;
    if (container === null) return;
    const { columnWidth, visibleCount } = measure(container);
    if (columnWidth <= 0) {
      // 隠れたまま開いたときは幅が 0 なので、出たときに合わせ直せるよう目標の日だけ覚えておく
      if (behavior === "instant" && index >= 0) settledIndexRef.current = index;
      return;
    }

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

  /**
   * 指で送っている途中に 4 週間を読み直したとき、押し始めの位置を新しい 4 週間の位置に置き直す。
   *
   * 読み直すと前に列が増える（減る）ので、同じ日でも `scrollLeft` がずれる。押し始めの位置を古いままにすると、
   * 次の pointermove が読み直した後の合わせ直し（下の effect）を取り消し、別の日へ跳んでしまう。
   * 横に送っている途中なら、増えた列のぶん押し始めの位置をずらし、指の下にある日を保つ。
   * 戻る・進むで別の基準の日へ移ったときは、指の動きとつながらないので送る操作をやめる。
   */
  const carrySwipeOver = (previousFirstDayKey: string | undefined, isReload: boolean) => {
    const swipe = swipeRef.current;
    const container = containerRef.current;
    if (swipe === null || container === null) return;

    if (swipe.phase === "pending") {
      // まだ動かしていないので、合わせ直した位置から数える
      swipeRef.current = { ...swipe, startScrollLeft: container.scrollLeft };
      return;
    }

    const previousFirstDay = parseTokyoDateKey(previousFirstDayKey ?? null);
    const firstDay = days[0];
    const { columnWidth } = measure(container);
    if (!isReload || previousFirstDay === null || firstDay === undefined || columnWidth <= 0) {
      swipeRef.current = null;
      // 離したときに handlePointerEnd が受けないので、ここで click を捨てる印を付ける
      swipedRef.current = true;
      return;
    }

    const startScrollLeft =
      swipe.startScrollLeft + tokyoDaysUntil(previousFirstDay, firstDay.date) * columnWidth;
    const lastX = swipe.samples.at(-1)?.x ?? swipe.startX;
    swipeRef.current = { ...swipe, startScrollLeft };
    // 合わせ直し（settle）が scroll-snap を戻したので、離すまで外し直す
    container.style.scrollSnapType = "none";
    container.scrollLeft = startScrollLeft - (lastX - swipe.startX);
  };

  /*
   * 読み直した後（先頭の日付が変わったとき）。列は日付をキーにしているので同じ DOM が使い回されるが、
   * 前に列が増えたぶん横にずれる。描画の前に、合わせる日へ戻す。
   * 戻る・進むで別の基準の日へ移ったときは、合わせる日が無いので基準の日へ合わせる。
   * 指で送っている途中なら、押し始めの位置も新しい 4 週間に置き直す（carrySwipeOver）。
   */
  const firstDayKey = days[0]?.dateKey;
  const alignedFirstDayKeyRef = useRef(firstDayKey);
  useLayoutEffect(() => {
    const previousFirstDayKey = alignedFirstDayKeyRef.current;
    if (previousFirstDayKey === firstDayKey) return;
    alignedFirstDayKeyRef.current = firstDayKey;
    const alignKey = pendingAlignKeyRef.current;
    pendingAlignKeyRef.current = null;
    scrollToIndex(findDayIndex(days, alignKey ?? anchorKey), "instant");
    carrySwipeOver(previousFirstDayKey, alignKey !== null);
  }, [firstDayKey]);

  /**
   * 端に近づいていれば、先頭の日を基準の日にして読み直す。
   *
   * ほかの遷移の途中・なめらかに送っている途中・指で横に送っている途中は見送る。
   * 読み直しが重なると、合わせる日が入れ替わる。指で送っている途中の位置は、止まる位置ではない。
   * 見送ったぶんは、遷移が終わったときと、スクロールが止まったときに確かめ直す。
   */
  const reloadIfNearEdge = () => {
    const container = containerRef.current;
    if (
      container === null ||
      isNavigating ||
      targetIndexRef.current !== null ||
      swipeRef.current?.phase === "horizontal"
    ) {
      return;
    }
    const { columnWidth, visibleCount, firstIndex } = measure(container);
    if (columnWidth <= 0 || !needsWindowShift(firstIndex, visibleCount, days.length)) return;
    const firstDay = days[firstIndex];
    if (firstDay !== undefined) reload(firstDay.dateKey);
  };

  /** スクロールが止まったとき。先頭の日を覚え、端に近づいていれば読み直す */
  const handleSettled = () => {
    // 指で横に送っている最中は、途中で止めても確定させない（離したときに送る）
    if (swipeRef.current?.phase === "horizontal") return;
    const container = containerRef.current;
    if (container === null) return;
    container.style.scrollSnapType = "";
    const { columnWidth, visibleCount, firstIndex } = measure(container);
    if (columnWidth <= 0) return;
    settle(firstIndex, visibleCount);
    reloadIfNearEdge();
  };

  /**
   * 箱の幅が変わったとき。表示日数や列の幅が変わるので、止まっていた先頭の日を保つ位置へ合わせ直す。
   *
   * スマホで欄を広げている間（2 段階（選ぶ・入力する）の入力段階）は、カレンダーを隠す（ADR-014 決定 13）。
   * Safari は隠した箱の横の位置を 0 に戻すので、
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

  const handlePointerDown = (event: PointerEvent) => {
    swipedRef.current = false;
    if (event.pointerType !== "touch") return;
    // 2 本目の指（ピンチ拡大など）が触れたら、進行中の待機は取りやめる
    if (!event.isPrimary) {
      if (swipeRef.current?.phase === "pending") swipeRef.current = null;
      return;
    }
    if (
      event.target instanceof Element &&
      event.target.closest("[data-slot='draft-start-handle'], [data-slot='draft-end-handle']") !==
        null
    ) {
      return;
    }
    const container = containerRef.current;
    if (container === null) return;

    swipeRef.current = {
      phase: "pending",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: container.scrollLeft,
      samples: [{ x: event.clientX, time: event.timeStamp }],
    };
  };

  const handlePointerMove = (event: PointerEvent) => {
    const swipe = swipeRef.current;
    if (swipe === null || event.pointerType !== "touch" || event.pointerId !== swipe.pointerId) {
      return;
    }
    const container = containerRef.current;
    if (container === null) return;

    const dx = event.clientX - swipe.startX;

    if (swipe.phase === "pending") {
      const dy = event.clientY - swipe.startY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDy >= SWIPE_LOCK_THRESHOLD_PX && absDy >= absDx) {
        // 縦の動きが先に大きくなったらブラウザの縦スクロールに任せる
        swipeRef.current = null;
        return;
      }
      if (absDx < SWIPE_LOCK_THRESHOLD_PX || absDx <= absDy) return;

      // 横に送る操作を始めるときは scroll-snap を外す（止まったあと handleSettled で戻す）
      container.style.scrollSnapType = "none";
      targetIndexRef.current = null;
      swipeRef.current = {
        phase: "horizontal",
        pointerId: swipe.pointerId,
        startX: swipe.startX,
        startScrollLeft: swipe.startScrollLeft,
        samples: swipe.samples,
      };
    }

    const active = swipeRef.current;
    if (active === null || active.phase !== "horizontal") return;

    container.scrollLeft = active.startScrollLeft - dx;
    active.samples.push({ x: event.clientX, time: event.timeStamp });
    while (
      active.samples.length > 1 &&
      event.timeStamp - active.samples[0].time > SWIPE_VELOCITY_WINDOW_MS
    ) {
      active.samples.shift();
    }
  };

  const handlePointerEnd = (event: PointerEvent) => {
    const swipe = swipeRef.current;
    if (swipe === null || event.pointerType !== "touch" || event.pointerId !== swipe.pointerId) {
      return;
    }
    swipeRef.current = null;
    if (swipe.phase !== "horizontal") return;

    swipedRef.current = true;
    const container = containerRef.current;
    if (container === null) return;
    const { columnWidth, visibleCount } = measure(container);
    if (columnWidth <= 0) {
      container.style.scrollSnapType = "";
      return;
    }

    const scrollVelocity = measureScrollVelocity(swipe.samples, event.clientX, event.timeStamp);
    const to = toSwipeTargetIndex({
      days,
      startScrollLeft: swipe.startScrollLeft,
      currentScrollLeft: container.scrollLeft,
      columnWidth,
      visibleCount,
      scrollVelocity,
    });
    const targetLeft = to * columnWidth;
    if (Math.abs(container.scrollLeft - targetLeft) < 1) {
      // 端などで位置が変わらず scroll イベントが起きないときは、ここで止まった扱いにする
      handleSettled();
      return;
    }
    container.scrollTo({ left: targetLeft, behavior: "smooth" });
    targetIndexRef.current = to;
  };

  const handleClickCapture = (event: MouseEvent) => {
    if (!swipedRef.current) return;
    swipedRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleKeyDown = () => {
    swipedRef.current = false;
  };

  /*
   * scroll・ResizeObserver・指の操作は 1 度だけ登録し、中では最新の処理を呼ぶ。
   * 描画のたびに登録し直すと、止まるのを待っている間の timer やスワイプの途中が消えてしまう。
   */
  const handlersRef = useRef({
    handleSettled,
    handleResize,
    reloadIfNearEdge,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    handleClickCapture,
    handleKeyDown,
  });
  useLayoutEffect(() => {
    handlersRef.current = {
      handleSettled,
      handleResize,
      reloadIfNearEdge,
      handlePointerDown,
      handlePointerMove,
      handlePointerEnd,
      handleClickCapture,
      handleKeyDown,
    };
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
    const onPointerDown = (event: PointerEvent) => handlersRef.current.handlePointerDown(event);
    const onPointerMove = (event: PointerEvent) => handlersRef.current.handlePointerMove(event);
    const onPointerEnd = (event: PointerEvent) => handlersRef.current.handlePointerEnd(event);
    const onClickCapture = (event: MouseEvent) => handlersRef.current.handleClickCapture(event);
    const onKeyDown = () => handlersRef.current.handleKeyDown();
    const observer = new ResizeObserver(() => handlersRef.current.handleResize());

    container.addEventListener("scroll", onScroll, { passive: true });
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("click", onClickCapture, { capture: true });
    container.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd);
    window.addEventListener("pointercancel", onPointerEnd);
    observer.observe(container);
    return () => {
      clearTimeout(timer);
      container.style.scrollSnapType = "";
      container.removeEventListener("scroll", onScroll);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("click", onClickCapture, { capture: true });
      container.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
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
      // 隠れていたカレンダーが出た直後は ResizeObserver より先にこのフレームが走ることがあるため、先に幅を合わせる
      handleResize();
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
