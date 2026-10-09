import { env } from "cloudflare:workers";
import { Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Card, CardContent } from "~/components/ui/card";
import { createDb } from "~/infra/db";
import { createFacilityCalendarSubscriptionListQuery } from "~/infra/facility/facility-calendar-subscription-list-query";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { listFacilitiesForCalendarSubscriptionUseCase } from "~/usecases/facility/list-facilities-for-calendar-subscription";

import type { Route } from "./+types/route";
import { CalendarSubscriptionCard } from "./calendar-subscription-card";

export function meta() {
  return [{ title: "カレンダー購読 | iclub-reserve" }];
}

/**
 * カレンダー一覧・購読ページ（SCR-010 / UC-018）のローダー。
 *
 * 【認可・可視性についての判断】
 * この画面はログインしていれば誰でも閲覧可能とする（requireRequestUser）。
 * 所属団体の有無や事務局権限では絞り込まない。
 * なぜなら、カレンダー購読用 URL は一度手に入れた後は外部のカレンダーアプリ経由で
 * 誰でも追加・参照できる公開情報であるため（REQ-030）、
 * ログイン以上の強い制限を課すことには意味が無いためである。
 */
export async function loader({ context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);

  const db = createDb(env.DB);
  const result = await listFacilitiesForCalendarSubscriptionUseCase(
    {
      facilityCalendarSubscriptionListQuery: createFacilityCalendarSubscriptionListQuery(db),
    },
    {
      actorUserId: user.id,
    },
  );

  if (result.isErr()) {
    throw queryErrorResponse({ where: "calendars.loader", userId: user.id }, result.error);
  }

  return {
    facilities: result.value,
  };
}

/**
 * カレンダー一覧・購読ページ（SCR-010 / UC-018）。
 */
export default function CalendarsPage({ loaderData }: Route.ComponentProps) {
  const { facilities } = loaderData;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8 max-w-4xl mx-auto w-full min-w-0">
      {/* 画面見出し */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">カレンダー購読</h1>
        <p className="text-sm text-muted-foreground">
          施設・設備ごとの承認済み予約カレンダーを、お使いのカレンダーアプリに追加・購読できます。
        </p>
      </div>

      {/* 案内文 */}
      <Alert className="border-border">
        <Info className="size-4" />
        <AlertTitle className="font-semibold">カレンダーの購読について</AlertTitle>
        <AlertDescription className="mt-2 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong>Google カレンダーをお使いの方</strong>: 各施設の「Google
              カレンダーに追加」ボタンを押すと、お使いの Google
              アカウントにカレンダーを追加できます。
            </li>
            <li>
              <strong>Apple カレンダー・Outlook などをお使いの方</strong>: iCal の URL
              をコピーし、カレンダーアプリの「照会」や「URL で追加」に貼り付けて登録してください。
            </li>
            <li>
              <strong>公開される情報</strong>:
              カレンダーに掲載されるのは承認済みの予約の「施設名」と「日時」のみです。利用団体名や個人情報は掲載されません。
            </li>
            <li>
              <strong>反映のタイミング</strong>:
              カレンダーアプリの同期間隔によっては、予約の最新状況が反映されるまでに時間がかかる場合があります。
            </li>
          </ul>
        </AlertDescription>
      </Alert>

      {/* 施設一覧 */}
      {facilities.length === 0 ? (
        <Card className="w-full">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            利用可能な施設・設備がありません。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 w-full min-w-0">
          {facilities.map((facility) => (
            <CalendarSubscriptionCard key={facility.id} facility={facility} />
          ))}
        </div>
      )}
    </div>
  );
}
