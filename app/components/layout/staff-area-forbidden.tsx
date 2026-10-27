import { isRouteErrorResponse, Link } from "react-router";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { AppArea, toAreaDashboardPath } from "~/lib/app-area";

/**
 * 両方に置く画面の事務局の画面を、事務局でない人が開いたか（ADR-016 決定 11）。
 *
 * 事務局の画面の loader が 403 を投げるのは、`requireAreaUser` が事務局でない人を止めたときだけである。
 * 事務局は横断権限（COND-009）で予約・団体・空き状況を読め、直接変更も許されているので、
 * ユースケースが 403 を返すことはない。
 */
export const isStaffAreaForbidden = (error: unknown, area: AppArea): boolean =>
  area === AppArea.Staff && isRouteErrorResponse(error) && error.status === 403;

/**
 * 事務局でない人が事務局の画面を開いたときの案内。ほかの事務局だけの画面と同じ文言にする。
 *
 * 戻り先は利用者の画面のダッシュボードにする。開いていた画面（事務局の画面）のダッシュボードや一覧へ戻すと、
 * そこも 403 になるためである。
 */
export function StaffAreaForbidden() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">事務局専用のページです</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">このページは、事務局のみご利用いただけます。</p>
          <Link
            to={toAreaDashboardPath(AppArea.User)}
            className="text-primary underline underline-offset-4"
          >
            ホームへ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
