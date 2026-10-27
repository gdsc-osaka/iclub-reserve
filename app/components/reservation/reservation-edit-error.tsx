import { isRouteErrorResponse, Link } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { AppArea } from "~/lib/app-area";
import { toReservationDetailPath } from "~/lib/reservation-paths";

/**
 * 予約の変更（UC-005 / UC-017）を開けなかったときのエラー画面。
 *
 * 変更の入口（`/reservations/:reservationId/edit`）と、空き状況カレンダーの変更の欄（`?edit=`）の
 * どちらのローダーが断っても、同じ画面を出す（ADR-014 決定 16）。
 *
 * ローダーが投げた応答には、エラーの表が決めた文言（`data.message`）が入っている。
 * 変更できない理由（権限が無い・終了した・状態が変わった）はそれで伝わるので、ここで書き分けない。
 * 見出しだけは、変更できない理由があるとき（403・409）と、一時的な失敗とで分ける。
 * 一時的な失敗に「変更できません」と出すと、本文の「時間をおいてお試しください」と食い違う。
 */
export function ReservationEditError({
  error,
  reservationId,
  area,
  backLink,
}: Readonly<{
  error: unknown;
  /** 変更しようとした予約。分かれば詳細へ戻るリンクを出す */
  reservationId: string | undefined;
  /** どちらの画面から開いているか */
  area: AppArea;
  /** 詳細の次に出す戻り道 */
  backLink: { readonly to: string; readonly label: string };
}>) {
  const isResponse = isRouteErrorResponse(error);
  const isNotFound = isResponse && error.status === 404;
  const isNotEditable = isResponse && (error.status === 403 || error.status === 409);

  const errorMessage =
    isResponse && typeof error.data === "object" && error.data !== null && "message" in error.data
      ? String(error.data.message)
      : isNotFound
        ? "予約が見つからないか、表示する権限がありません。"
        : "時間をおいて、もう一度お試しください。";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            <h1 className="text-xl font-bold">
              {isNotFound
                ? "予約が見つかりません"
                : isNotEditable
                  ? "この予約は変更できません"
                  : "変更の画面を表示できません"}
            </h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">{errorMessage}</p>
          <div className="flex flex-wrap items-center gap-4">
            {reservationId !== undefined && (
              <Link
                to={toReservationDetailPath(area, reservationId)}
                className="text-primary underline underline-offset-4"
              >
                予約の詳細へ戻る
              </Link>
            )}
            <Link to={backLink.to} className="text-primary underline underline-offset-4">
              {backLink.label}
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
