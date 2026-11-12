import { useEffect, useRef } from "react";
import { useFetchers, useNavigation, useRevalidator } from "react-router";

import {
  AUTO_REVALIDATE_CHECK_MS,
  RETURN_REVALIDATE_AFTER_MS,
  shouldAutoRevalidate,
} from "./auto-revalidate";

/**
 * ダイアログが開いているかを判定する。
 *
 * Radix のダイアログ（shadcn/ui の Dialog・AlertDialog・Sheet）は、開いている間だけ中身を DOM に置くので、
 * これで開いているかが分かる。ダイアログごとに開閉を知らせる仕組みを足すより、1 か所で済む。
 */
function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null;
}

/**
 * ダッシュボードのデータを自動で読み直すフック（ADR-019）。
 *
 * 画面に戻ってきたとき（タブのアクティブ化・オンライン復帰）や、定期的な間隔（intervalMs）で
 * `useRevalidator().revalidate()` を呼び出して画面を最新化する。
 * 戻ってきたときにダイアログなどで見送った読み直しは、読み直せるようになってから
 * AUTO_REVALIDATE_CHECK_MS のうちに行う（intervalMs が null でも）。
 *
 * 読み直すと外枠の loader も走り、ナビの件数もそろう（app/routes/app-layout/nav-counts.ts の shouldRecountNavCounts の 3）。
 * また、now を loader で決めているので、相対時刻・今日の予約の現在時刻の線・日付も新しくなる。
 */
export function useAutoRevalidate({
  loadedAt,
  intervalMs,
}: Readonly<{
  loadedAt: string;
  intervalMs: number | null;
}>): void {
  const revalidator = useRevalidator();
  const navigation = useNavigation();
  const fetchers = useFetchers();

  // サーバーとブラウザの時計のずれに左右されないよう、loadedAt の値そのものとは比べず、
  // 読み直しごとにブラウザの時計（Date.now()）を記録する
  const lastLoadedAtRef = useRef(Date.now());
  // 戻ってきたときの読み直しを、ダイアログ・送信の途中などで見送ったか
  const pendingReturnRef = useRef(false);

  useEffect(() => {
    lastLoadedAtRef.current = Date.now();
    // 読み直したので、見送っていた分も済んだ
    pendingReturnRef.current = false;
  }, [loadedAt]);

  const isBusy =
    navigation.state !== "idle" ||
    revalidator.state !== "idle" ||
    fetchers.some((fetcher) => fetcher.state !== "idle");

  const isBusyRef = useRef(isBusy);
  const revalidateRef = useRef(revalidator.revalidate);

  // タイマーとイベントの中から最新の isBusy と revalidator.revalidate を読むため ref を更新する
  useEffect(() => {
    isBusyRef.current = isBusy;
    revalidateRef.current = revalidator.revalidate;
  });

  useEffect(() => {
    // 戻ってきたとき、前回の読み込みからこれだけたっていれば読み直す
    const returnThresholdMs =
      intervalMs === null
        ? RETURN_REVALIDATE_AFTER_MS
        : Math.min(RETURN_REVALIDATE_AFTER_MS, intervalMs);

    /** 読み直したら true を返す */
    const tryRevalidate = (thresholdMs: number): boolean => {
      if (
        !shouldAutoRevalidate({
          isVisible: document.visibilityState === "visible",
          isOnline: navigator.onLine,
          isBusy: isBusyRef.current,
          isDialogOpen: isDialogOpen(),
          elapsedMs: Date.now() - lastLoadedAtRef.current,
          thresholdMs,
        })
      ) {
        return false;
      }
      void revalidateRef.current();
      return true;
    };

    const onReturn = () => {
      const isDue =
        document.visibilityState === "visible" &&
        Date.now() - lastLoadedAtRef.current >= returnThresholdMs;
      // 読み直す頃合いなのに見送ったときは覚えておき、ダイアログを閉じた後などに確かめ直す
      pendingReturnRef.current = isDue && !tryRevalidate(returnThresholdMs);
    };

    const onCheck = () => {
      if (pendingReturnRef.current) {
        pendingReturnRef.current = !tryRevalidate(returnThresholdMs);
        return;
      }
      if (intervalMs !== null) {
        tryRevalidate(intervalMs);
      }
    };

    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("online", onReturn);
    const intervalId = window.setInterval(onCheck, AUTO_REVALIDATE_CHECK_MS);

    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("online", onReturn);
      window.clearInterval(intervalId);
    };
  }, [intervalMs]);
}
