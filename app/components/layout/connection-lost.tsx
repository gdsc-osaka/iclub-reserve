import { useEffect, useRef } from "react";
import { useRevalidator } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

/**
 * 接続が戻ったかを確かめる間隔（30 秒）。
 *
 * online のイベントが来ない端末でも戻れるようにする。
 */
const CONNECTION_RETRY_MS = 30 * 1000;

/**
 * root の ErrorBoundary が通信のエラーのときに出す。
 *
 * 読み直しが成功すれば React Router がエラーを消して元の画面に戻る。
 * 事務局のダッシュボードのように開いたままにする画面が、通信が一瞬切れただけでエラー画面のまま止まらないようにする（ADR-019）。
 */
export function ConnectionLost() {
  const revalidator = useRevalidator();
  const isBusy = revalidator.state !== "idle";
  const revalidateRef = useRef(revalidator.revalidate);
  const isBusyRef = useRef(isBusy);

  useEffect(() => {
    revalidateRef.current = revalidator.revalidate;
    isBusyRef.current = isBusy;
  });

  useEffect(() => {
    const tryRevalidate = () => {
      if (navigator.onLine && !isBusyRef.current) {
        void revalidateRef.current();
      }
    };

    window.addEventListener("online", tryRevalidate);
    const intervalId = window.setInterval(tryRevalidate, CONNECTION_RETRY_MS);

    return () => {
      window.removeEventListener("online", tryRevalidate);
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">接続できませんでした</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">接続が戻ると、自動で表示し直します。</p>
          <div>
            <Button type="button" onClick={() => void revalidator.revalidate()} disabled={isBusy}>
              読み込み直す
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
