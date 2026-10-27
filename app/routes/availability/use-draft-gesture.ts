import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useLocation } from "react-router";

import {
  boundaryAtRatio,
  dragRange,
  resizeRange,
  slotAtRatio,
  type RangeEdge,
  type SlotRange,
} from "~/components/reservation/editor/reservation-slots";

import type { CalendarDraft } from "./paths";

/** なぞる操作・丸を動かす操作の途中の時間帯。描くのは時間帯のある仮の枠だけなので、時間帯は必ずある */
export type GestureDraft = Readonly<{ dateKey: string; range: SlotRange }>;

/**
 * 進行中の操作。
 *
 * 枠をなぞる操作（drag）と、仮の枠の端の丸を動かす操作（resize）の 2 種類がある。
 * どちらも「押し始めた日の本体（day-body）」を基準にして位置を計算する。
 * `range` はいまの途中の時間帯。なぞる操作で、まだ押し始めた枠から出ていなければ null。
 */
type ActiveGesture = Readonly<
  {
    dateKey: string;
    unselectableSlots: ReadonlySet<number>;
    dayBody: HTMLElement;
    range: SlotRange | null;
  } & (
    | { type: "drag"; anchorSlot: number }
    | { type: "resize"; edge: RangeEdge; initialRange: SlotRange }
  )
>;

const isSameRange = (a: SlotRange, b: SlotRange): boolean =>
  a.startMinutes === b.startMinutes && a.endMinutes === b.endMinutes;

/**
 * 位置（日の本体の高さに対する縦の割合）から、途中の時間帯を割り出す。
 *
 * なぞる操作は、押し始めた枠から出るまでは null を返す。1 枠も動かさずに離したら、
 * 今の「押した」扱い（1 時間、取れなければ 30 分）に任せるため。
 */
const toGestureRange = (gesture: ActiveGesture, ratio: number): SlotRange | null => {
  if (gesture.type === "resize") {
    return resizeRange(
      gesture.initialRange,
      gesture.edge,
      boundaryAtRatio(ratio),
      gesture.unselectableSlots,
    );
  }

  const hoveredSlot = slotAtRatio(ratio);
  if (gesture.range === null && hoveredSlot === gesture.anchorSlot) return null;
  return dragRange(gesture.anchorSlot, hoveredSlot, gesture.unselectableSlots);
};

/**
 * 空き状況カレンダーで仮の枠をなぞって選ぶ操作と、丸で伸び縮みさせる操作を受け持つフック（ADR-014 決定 12）。
 *
 * どちらの操作も「指やマウスを離すまでの途中の時間帯」を扱うため、1 つのフックにまとめている。
 * 操作中は URL を書き換えず手元の状態（gestureDraft）だけを更新し、離したときに 1 回だけ URL を書き換える。
 *
 * 離したあとも、画面の移動が済むまで（`location.key` が変わるまで）は途中の時間帯を描き続ける。
 * React Router は URL の書き換えを `startTransition` で描くので、離したときに消すと、
 * 書き換わる前の仮の枠が 1 フレーム戻って見える。
 * 待つのを「URL の仮の枠が途中の時間帯と同じになるまで」にしないのは、待っている間に別の枠を押すと、
 * そちらの移動が先の移動を打ち切り、いつまでも同じにならずに途中の時間帯が残ってしまうため。
 *
 * 押し始めた要素に `setPointerCapture` でポインタを固定するので、動かす・離す・中断の処理は
 * 押し始めた要素（30 分の枠か丸）に付ければ、ポインタがどこへ動いても届く。
 * 固定しないと、埋まっている枠（`disabled`）や予約の帯の上を通った瞬間にポインタを追えなくなる。
 */
export function useDraftGesture({
  onOpenDraft,
}: Readonly<{
  onOpenDraft: (draft: CalendarDraft) => void;
}>) {
  const location = useLocation();
  /*
   * 描くための途中の時間帯。時間帯が変わったときだけ書き換える（ポインタが動くたびに描き直さない）。
   * `releasedAt` は、離したときの `location.key`。離して画面の移動を待っている間だけ入る。
   */
  const [gestureDraft, setGestureDraft] = useState<
    (GestureDraft & Readonly<{ releasedAt: string | null }>) | null
  >(null);
  const gestureRef = useRef<ActiveGesture | null>(null);
  /** 直前の操作がなぞる操作だったか。なぞり終わりの click を捨てるために使う */
  const draggedRef = useRef(false);

  // 離したあとの画面の移動が済んだら、途中の時間帯をやめて URL の仮の枠を描く
  const releasedAt = gestureDraft?.releasedAt ?? null;
  if (releasedAt !== null && releasedAt !== location.key) {
    setGestureDraft(null);
  }

  const start = (event: ReactPointerEvent, gesture: ActiveGesture) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = gesture;
    draggedRef.current = false;
  };

  /**
   * 30 分の枠を押したときに、なぞる操作を始める。
   *
   * 指の操作はカレンダーのスクロールに使うので、マウス・ペンの左ボタン（`button === 0`）だけを受け付ける。
   * 押せない枠（`disabled`）は `pointer-events-none` なので、ここへは来ない。
   */
  const onSlotPointerDown = (
    event: ReactPointerEvent,
    dateKey: string,
    slotMinutes: number,
    unselectableSlots: ReadonlySet<number>,
  ) => {
    if (event.pointerType === "touch" || event.button !== 0) return;

    const dayBody = event.currentTarget.closest<HTMLElement>("[data-slot='day-body']");
    if (dayBody === null) return;

    start(event, {
      type: "drag",
      dateKey,
      anchorSlot: slotMinutes,
      unselectableSlots,
      dayBody,
      range: null,
    });
  };

  /**
   * 仮の枠の開始・終了の丸を押したときに、伸び縮みの操作を始める。
   *
   * 丸は指でもマウス（左ボタン）でも動かせる。
   */
  const onHandlePointerDown = (
    event: ReactPointerEvent,
    dateKey: string,
    initialRange: SlotRange,
    edge: RangeEdge,
    unselectableSlots: ReadonlySet<number>,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const dayBody = event.currentTarget.closest<HTMLElement>("[data-slot='day-body']");
    if (dayBody === null) return;

    start(event, {
      type: "resize",
      dateKey,
      edge,
      initialRange,
      unselectableSlots,
      dayBody,
      range: initialRange,
    });
  };

  /** ポインタが動いたら、位置から途中の時間帯を割り出し、変わったときだけ描き直す */
  const onPointerMove = (event: ReactPointerEvent) => {
    const gesture = gestureRef.current;
    if (gesture === null) return;

    const rect = gesture.dayBody.getBoundingClientRect();
    if (rect.height === 0) return;

    const range = toGestureRange(gesture, (event.clientY - rect.top) / rect.height);
    if (range === null || (gesture.range !== null && isSameRange(range, gesture.range))) return;

    gestureRef.current = { ...gesture, range };
    setGestureDraft({ dateKey: gesture.dateKey, range, releasedAt: null });
  };

  /** 離したら、押し始めから時間帯が変わっていれば、URL の仮の枠を 1 回だけ書き換える */
  const onPointerUp = () => {
    const gesture = gestureRef.current;
    if (gesture === null) return;

    gestureRef.current = null;
    draggedRef.current = gesture.type === "drag" && gesture.range !== null;

    const { dateKey, range } = gesture;
    const hasChanged =
      range !== null && (gesture.type === "drag" || !isSameRange(range, gesture.initialRange));
    if (!hasChanged) {
      setGestureDraft(null);
      return;
    }
    setGestureDraft({ dateKey, range, releasedAt: location.key });
    onOpenDraft({ dateKey, range });
  };

  /** 中断されたら（スクロールに切り替わったなど）、途中の時間帯を捨てて何も書き換えない */
  const onPointerCancel = () => {
    gestureRef.current = null;
    draggedRef.current = false;
    setGestureDraft(null);
  };

  /** 枠を押したとき（click）。なぞり終わりにも click が来るので、なぞった直後の 1 回は捨てる */
  const onSlotClick = (onSelect: () => void) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onSelect();
  };

  return {
    gestureDraft,
    onSlotPointerDown,
    onHandlePointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onSlotClick,
  };
}

export type DraftGesture = ReturnType<typeof useDraftGesture>;
