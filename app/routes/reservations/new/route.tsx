import { env } from "cloudflare:workers";
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { isRouteErrorResponse, Link, redirect } from "react-router";

import { NoEnabledGroupReason } from "~/components/reservation/no-enabled-group-reason";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  fieldKeyOf,
  parseReservation,
  readValues,
  toFormErrors,
  type ReservationFormMode,
} from "~/components/reservation/editor/form-values";
import { ReservationEditorForm } from "~/components/reservation/editor/reservation-editor-form";
import { createDb } from "~/infra/db";
import { createFacilityRepository } from "~/infra/facility/facility-repo";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationFormQuery } from "~/infra/reservation/reservation-form-query";
import { createReservationMailRecipientsQuery } from "~/infra/reservation/reservation-mail-recipients-query";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import { createUserGroupListQuery } from "~/infra/user/user-group-list-query";
import { resolveAppBaseUrl } from "~/lib/app-url.server";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import {
  addDays,
  parseTokyoDateKey,
  parseTokyoTimeKey,
  startOfTokyoDay,
  toTokyoDateKey,
} from "~/lib/date";
import type { ReservationFormFacility } from "~/query/reservation/reservation-form";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { reservationActionErrors } from "~/routes/_shared/reservation-error.server";
import { createDirectReservationUseCase } from "~/usecases/reservation/create-direct-reservation";
import { createProvisionalReservationUseCase } from "~/usecases/reservation/create-reservation";
import { getReservationFormUseCase } from "~/usecases/reservation/get-reservation-form";

import type { Route } from "./+types/route";
import { CreatedPanel } from "./created-panel";
import { toCalendarPath } from "./paths";

export function meta() {
  return [{ title: "仮予約の申請 | iclub-reserve" }];
}

/**
 * 表示する施設を 1 件選ぶ。
 *
 * 指定が無い・存在しない施設だったときは先頭に戻す。
 * 空き状況カレンダー（SCR-001）と違ってここを 404 にしないのは、
 * クエリが「画面そのもの」ではなく入力の初期値だから。
 * 初期値が合わないだけで申請を始められなくするのは行きすぎている。
 */
const pickFacilityId = (
  facilities: readonly ReservationFormFacility[],
  requested: string | null,
): string =>
  facilities.find((facility) => facility.id === requested)?.id ?? facilities.at(0)?.id ?? "";

/**
 * 予約申請フォーム（SCR-002）に出すデータを取る。
 *
 * 施設と日付は URL のクエリで受け取る。空き状況カレンダーから
 * 「この施設のこの日時で申請する」と渡ってくるのがこの画面の主な入り口なので、
 * 受け取った内容をそのまま初期値にする。
 * クエリは利用者が自由に書き換えられるので、値はすべて確かめてから使う。
 *
 * 読むのは選んでいる 1 日ぶんだけ。日付を変える操作はこの URL への移動なので、
 * 変えたぶんはその都度ここが読み直す。施設は絞らずに取るため、
 * 施設を切り替えるだけならサーバーへの往復は起きない。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)
  const user = requireRequestUser(context);

  const url = new URL(request.url);

  /*
   * 「いま」はローダーで 1 回だけ読んで画面へ渡す。
   * 描画のたびに new Date() を呼ぶと、サーバーで描いた内容とブラウザで
   * 描き直した内容が食い違い、画面がちらつく。
   */
  const now = new Date();

  // 日付の指定が無い・壊れているときは今日を出す。エラーにはしない
  const day = startOfTokyoDay(parseTokyoDateKey(url.searchParams.get("date")) ?? now);

  const db = createDb(env.DB);

  const result = await getReservationFormUseCase(
    {
      reservationFormQuery: createReservationFormQuery(db),
      userGroupListQuery: createUserGroupListQuery(db),
      reservationRepository: createReservationRepository(db),
    },
    {
      actorUserId: user.id,
      isStaff: user.is_staff,
      from: day,
      // 終わりは「翌日の 0 時」。この時刻は含まない
      to: addDays(day, 1),
      createdReservationId: url.searchParams.get("created"),
    },
  );

  if (result.isErr()) {
    // 失敗の中身は画面へ出さず、ログにだけ残す。決めているのは表の側
    throw queryErrorResponse({ where: "reservations.new.loader", userId: user.id }, result.error);
  }

  const form = result.value;
  /*
   * 直接作成（UC-008）の切り替えを最初からオンにして開くか。空き状況カレンダーの
   * 「承認済みで直接作成」から来たとき。事務局でない人が URL に付けても、切り替えごと出さない。
   */
  const mode: ReservationFormMode =
    form.canCreateDirectly && url.searchParams.get("mode") === "direct" ? "direct" : "provisional";

  return {
    form,
    now,
    isStaff: user.is_staff,
    /** 日付の入力欄の下限。過ぎた日はブラウザの時点で選べなくする */
    todayKey: toTokyoDateKey(now),
    /** 空き状況カレンダーから引き継いだ初期値 */
    initial: {
      facilityId: pickFacilityId(form.facilities, url.searchParams.get("facility")),
      dateKey: toTokyoDateKey(day),
      startMinutes: parseTokyoTimeKey(url.searchParams.get("start")),
      mode,
    },
  };
}

/**
 * 仮予約を申請する（UC-002）か、事務局が承認済みの予約を直接作成する（UC-008）。
 *
 * ステータスは受け取らない。どちらで作るかは `mode` で選び、仮予約か承認済みかは
 * それぞれのユースケースが決める（STATE-001）。事務局でない人が `mode=direct` を送っても、
 * 直接作成のユースケースが Forbidden で止め、ログに残す。
 *
 * 成功したら、同じ画面の「申請できました」に転送する。
 * 送信の結果をそのまま描くと、完了画面での再読み込みが再送信になり、
 * 同じ予約がもう一度作られてしまう。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);

  const formData = await request.formData();
  const values = readValues(formData);
  const now = new Date();

  const { reservation, fieldErrors } = parseReservation(values, now);

  if (reservation === null) {
    return { values, fieldErrors, formError: null };
  }

  const db = createDb(env.DB);
  const isDirect = values.mode === "direct";
  const deps = {
    reservationRepository: createReservationRepository(db),
    membershipRepository: createMembershipRepository(db),
    groupRepository: createGroupRepository(db),
    facilityRepository: createFacilityRepository(db),
  };
  const args = {
    actorUserId: user.id,
    isStaff: user.is_staff,
    now,
    reservation,
    appBaseUrl: resolveAppBaseUrl(request),
  };

  // 直接作成ではメールを送らないので、通知に使う依存は申請のときだけ渡す
  const result = isDirect
    ? await createDirectReservationUseCase(deps, args)
    : await createProvisionalReservationUseCase(
        {
          ...deps,
          reservationMailRecipientsQuery: createReservationMailRecipientsQuery(db),
          mailOutboxNotifier: createQueueMailOutboxNotifier(),
        },
        args,
      );

  if (result.isErr()) {
    return {
      values,
      ...toFormErrors(
        reservationActionErrors(
          {
            where: isDirect ? "reservations.new.direct" : "reservations.new.action",
            userId: user.id,
          },
          result.error,
          fieldKeyOf,
        ),
      ),
    };
  }

  const params = new URLSearchParams({
    created: result.value.reservationId,
    facility: reservation.facilityId,
    date: values.dateKey,
  });

  throw redirect(`/reservations/new?${params.toString()}`);
}

/**
 * 仮予約の申請フォーム（SCR-002 / UC-002 / UC-008）。
 *
 * 申請できるのは有効な団体だけで（COND-006）、事務局は所属に関わらず
 * 任意の団体として申請・直接作成できる（COND-009）。どちらの候補を出すかはローダーが決めていて、
 * この画面は渡された候補を並べるだけにしている。
 */
export default function NewReservation({ loaderData, actionData }: Route.ComponentProps) {
  const { form, now, isStaff, todayKey, initial } = loaderData;

  if (form.created !== null) {
    return (
      <PageShell facilityId={initial.facilityId} dateKey={initial.dateKey}>
        <CreatedPanel
          created={form.created}
          facilityId={initial.facilityId}
          dateKey={initial.dateKey}
        />
      </PageShell>
    );
  }

  if (form.groups.length === 0 || form.facilities.length === 0) {
    return (
      <PageShell facilityId={initial.facilityId} dateKey={initial.dateKey}>
        <CannotApplyCard
          hasGroup={form.groups.length > 0}
          hasFacility={form.facilities.length > 0}
          isStaff={isStaff}
        />
      </PageShell>
    );
  }

  return (
    <PageShell facilityId={initial.facilityId} dateKey={initial.dateKey}>
      <ReservationEditorForm
        purpose={{
          kind: "create",
          groups: form.groups,
          canCreateDirectly: form.canCreateDirectly,
        }}
        facilities={form.facilities}
        reservations={form.reservations}
        now={now}
        todayKey={todayKey}
        initial={initial}
        actionData={actionData ?? null}
      />
    </PageShell>
  );
}

/** 見出しと戻る導線。どの状態でも同じ位置に出す */
function PageShell({
  facilityId,
  dateKey,
  children,
}: Readonly<{ facilityId: string; dateKey: string; children: ReactNode }>) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <Link
          to={toCalendarPath(facilityId, dateKey)}
          className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← 空き状況カレンダーへ戻る
        </Link>

        <h1 className="text-xl font-semibold">仮予約の申請</h1>

        <p className="text-sm text-muted-foreground">
          申請すると仮予約として登録されます。施設・設備を利用できるのは、事務局が承認してからです。
        </p>
      </div>

      {children}
    </main>
  );
}

/**
 * 申請を始められない理由を説明する（COND-006）。
 *
 * フォームを空のまま出しても、何が足りないのかが分からない。
 */
function CannotApplyCard({
  hasGroup,
  hasFacility,
  isStaff,
}: Readonly<{ hasGroup: boolean; hasFacility: boolean; isStaff: boolean }>) {
  return (
    <Alert className="border-amber-500/30 bg-amber-500/5">
      <CircleAlert aria-hidden className="text-amber-600 dark:text-amber-400" />
      <AlertTitle>まだ申請できません</AlertTitle>
      <AlertDescription>
        {!hasGroup &&
          (isStaff ? (
            "申請元にできる有効な団体がまだ 1 つもありません。団体を有効にしてから申請してください。"
          ) : (
            <NoEnabledGroupReason />
          ))}
        {hasGroup && !hasFacility && "予約できる施設・設備がまだ登録されていません。"}
      </AlertDescription>
    </Alert>
  );
}

/**
 * このルートで例外が起きたときに出す画面。
 *
 * ローダーが投げた 500 をここで受け取り、利用者向けの日本語の案内に置き換える。
 * ルート単位のエラー画面がないと、root.tsx の英語の共通エラー画面が出てしまう。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isNotFound ? "ページが見つかりません" : "申請フォームを表示できません"}
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">時間をおいて、もう一度お試しください。</p>

          <Link to="/availability" className="text-primary underline underline-offset-4">
            空き状況カレンダーへ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
