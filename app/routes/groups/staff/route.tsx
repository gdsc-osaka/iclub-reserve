import { env } from "cloudflare:workers";
import { CheckCircle2, CircleAlert, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, isRouteErrorResponse, Link, useNavigation } from "react-router";

import { GroupStatusBadge, groupStatusLabel } from "~/components/group/group-status-badge";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { GroupStatus } from "~/domain/group";
import { createDb } from "~/infra/db";
import { createGroupSearchQuery } from "~/infra/group/group-search-query";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { formatFullDate } from "~/lib/date";
import { cn } from "~/lib/utils";
import type { GroupSearchItem } from "~/query/group/group-search";
import { groupActionErrors } from "~/routes/_shared/group-error.server";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { changeGroupStatusUseCase } from "~/usecases/group/change-group-status";
import { searchGroupsUseCase } from "~/usecases/group/search-groups";

import type { Route } from "./+types/route";
import {
  parseStaffGroupParams,
  toDomainGroupStatus,
  toStaffGroupPath,
  type StaffGroupStatusFilter,
} from "./query-params";

export function meta() {
  return [{ title: "団体の管理 | iclub-reserve" }];
}

/**
 * 事務局向け全団体管理画面（SCR-008）のローダー。
 *
 * 事務局スタッフのみ閲覧可能（COND-009）。非スタッフはユースケースで Forbidden が返り、
 * 403 エラーレスポンスとしてログに残る。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);

  const url = new URL(request.url);
  const params = parseStaffGroupParams(url.searchParams);

  const db = createDb(env.DB);
  const result = await searchGroupsUseCase(
    { groupSearchQuery: createGroupSearchQuery(db) },
    {
      actorUserId: user.id,
      isStaff: user.is_staff,
      status: toDomainGroupStatus(params.status),
    },
  );

  if (result.isErr()) {
    throw queryErrorResponse({ where: "staff.groups.loader", userId: user.id }, result.error);
  }

  return {
    items: result.value.items,
    counts: result.value.counts,
    params,
  };
}

/**
 * 事務局による団体の有効化・無効化アクション（UC-014）。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const formData = await request.formData();

  if (formData.get("intent") !== "change-status") {
    return { formError: "不正な操作です。" };
  }

  /*
   * 団体 ID と変更先の検証（空・有効/無効以外）はユースケースが行うので、ここでは文字列にそろえるだけ。
   * ここで先に弾くと判定が 2 か所に分かれ、ログにも残らない。
   */
  const rawGroupId = formData.get("groupId");
  const rawStatus = formData.get("status");
  const groupId = typeof rawGroupId === "string" ? rawGroupId : "";
  const status = typeof rawStatus === "string" ? rawStatus : "";

  const db = createDb(env.DB);
  const result = await changeGroupStatusUseCase(
    {
      groupRepository: createGroupRepository(db),
      membershipRepository: createMembershipRepository(db),
    },
    {
      groupId,
      actorUserId: user.id,
      isStaff: user.is_staff,
      status,
      now: new Date(),
    },
  );

  if (result.isErr()) {
    // 一覧には入力欄が無いので、誤りはすべて一覧の上（formError）に出す
    return groupActionErrors(
      { where: "staff.groups.change-status", userId: user.id },
      result.error,
    );
  }

  /*
   * /staff/reservations と違ってリダイレクト（PRG）せず、結果を返して一覧の上に出す。
   * 承認待ちの絞り込みでは、操作した団体が一覧から消えるだけなので、
   * 何をしたかを書いて見せないと、有効にしたのか無効にしたのかが分からなくなるため。
   * 同じ送信が繰り返されても、2 回目は状態が変わっているので InvalidTransition で止まる。
   */
  return {
    success: {
      groupName: result.value.name,
      status: result.value.status,
    },
  };
}

/**
 * 事務局向け全団体管理画面のルートコンポーネント。
 */
export default function StaffGroupsRoute({ loaderData, actionData }: Route.ComponentProps) {
  const { items, counts, params } = loaderData;

  const tabs: readonly {
    readonly key: StaffGroupStatusFilter;
    readonly label: string;
    readonly count: number;
  }[] = [
    // 状態の名前は各行のバッジと同じ表から取り、タブとバッジで呼び名が食い違わないようにする
    { key: "pending", label: groupStatusLabel[GroupStatus.Pending], count: counts.pending },
    { key: "enabled", label: groupStatusLabel[GroupStatus.Enabled], count: counts.enabled },
    { key: "disabled", label: groupStatusLabel[GroupStatus.Disabled], count: counts.disabled },
    { key: "all", label: "すべて", count: counts.pending + counts.enabled + counts.disabled },
  ];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight">団体の管理</h1>
        <p className="text-sm text-muted-foreground">
          団体の確認と、有効化・無効化の切り替えを行います。
        </p>
      </div>

      {actionData && "success" in actionData && actionData.success && (
        <Alert className="border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300">
          <CheckCircle2 className="size-4" />
          <AlertTitle>団体の状態を変更しました</AlertTitle>
          <AlertDescription>
            {`${actionData.success.groupName} を「${groupStatusLabel[actionData.success.status]}」にしました。`}
          </AlertDescription>
        </Alert>
      )}

      {actionData && "formError" in actionData && actionData.formError && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>操作に失敗しました</AlertTitle>
          <AlertDescription>{actionData.formError}</AlertDescription>
        </Alert>
      )}

      {/* 状態絞り込みピルタブ（/staff/reservations の絞り込みにそろえる） */}
      <nav aria-label="ステータスの絞り込み" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ul className="flex w-max gap-1.5">
          {tabs.map((tab) => {
            const isCurrent = params.status === tab.key;

            return (
              <li key={tab.key}>
                <Link
                  to={toStaffGroupPath({ status: tab.key })}
                  aria-current={isCurrent ? "page" : undefined}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                    isCurrent
                      ? "border-primary bg-primary font-medium text-primary-foreground"
                      : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span>{tab.label}</span>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.2 text-xs",
                      isCurrent
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {tab.count}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 団体一覧（スマホ幅 320px〜 でも横スクロールしないカード形式） */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          該当する団体はありません。
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id}>
              <StaffGroupRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * 事務局一覧の 1 団体分の行コンポーネント。
 */
function StaffGroupRow({ item }: Readonly<{ item: GroupSearchItem }>) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 transition-colors sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/groups/${item.id}`}
            className="truncate font-medium text-foreground hover:underline hover:underline-offset-4"
          >
            {item.name}
          </Link>
          <GroupStatusBadge status={item.status} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users aria-hidden className="size-3.5" />
            メンバー {item.memberCount} 人
          </span>
          <span>登録日: {formatFullDate(new Date(item.createdAt))}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-2 sm:pt-0">
        {item.status === GroupStatus.Pending && (
          <>
            <EnableGroupButton groupId={item.id} />
            <DisableGroupDialog groupId={item.id} groupName={item.name} />
          </>
        )}
        {item.status === GroupStatus.Enabled && (
          <DisableGroupDialog groupId={item.id} groupName={item.name} />
        )}
        {item.status === GroupStatus.Disabled && <EnableGroupButton groupId={item.id} />}
      </div>
    </div>
  );
}

/**
 * この団体をこの状態へ変える送信が、いま進んでいるかどうか。
 *
 * 同じ画面に他の団体のボタンが並ぶので、団体 ID と変更先まで見て、押したボタンだけを「処理中」にする。
 */
const useIsChangingStatus = (groupId: string, status: GroupStatus): boolean => {
  const navigation = useNavigation();

  return (
    navigation.state === "submitting" &&
    navigation.formData?.get("intent") === "change-status" &&
    navigation.formData.get("groupId") === groupId &&
    navigation.formData.get("status") === status
  );
};

/** 有効化ボタン（確認なしで送信） */
function EnableGroupButton({ groupId }: Readonly<{ groupId: string }>) {
  const isSubmitting = useIsChangingStatus(groupId, GroupStatus.Enabled);

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="change-status" />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="status" value={GroupStatus.Enabled} />
      <Button type="submit" size="sm" disabled={isSubmitting}>
        {isSubmitting ? "処理中…" : "有効化"}
      </Button>
    </Form>
  );
}

/** 無効化ボタンと確認ダイアログ */
function DisableGroupDialog({
  groupId,
  groupName,
}: Readonly<{ groupId: string; groupName: string }>) {
  const [open, setOpen] = useState(false);
  const isSubmitting = useIsChangingStatus(groupId, GroupStatus.Disabled);

  /*
   * 送信が終わったら、このダイアログを自分で閉じる（member-action-dialog.tsx と同じ）。
   *
   * 開閉は open の state だけで決まるので、閉じる処理を書かないと送信後も開いたままになる。
   * 失敗したとき（別の事務局が先に変えていた、など）は団体が一覧に残るため、
   * 一覧の上に出した誤りがダイアログに隠れて読めなくなる。
   */
  const hasSubmittedRef = useRef(false);
  useEffect(() => {
    if (isSubmitting) {
      hasSubmittedRef.current = true;
      return;
    }

    if (hasSubmittedRef.current) {
      hasSubmittedRef.current = false;
      setOpen(false);
    }
  }, [isSubmitting]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          無効化
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-md">
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="change-status" />
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="status" value={GroupStatus.Disabled} />

          <AlertDialogHeader>
            <AlertDialogTitle>{groupName} を無効にしますか？</AlertDialogTitle>
            <AlertDialogDescription>
              無効にすると、この団体では予約を申請できなくなります。すでにある予約はそのまま残ります。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={isSubmitting}>
              キャンセル
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={isSubmitting}>
              {isSubmitting ? "処理中…" : "無効化する"}
            </Button>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * 事務局画面のエラーバウンダリ。
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const isForbidden = isRouteErrorResponse(error) && error.status === 403;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Card className="[--card-spacing:--spacing(6)]">
        <CardHeader>
          <CardTitle className="text-xl">
            {isForbidden ? "事務局スタッフ専用ページです" : "団体一覧を表示できません"}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">
            {isForbidden
              ? "この画面は事務局アカウントでのみご利用いただけます。"
              : "時間をおいて、もう一度お試しください。"}
          </p>
          <Link to="/" className="text-primary underline underline-offset-4">
            ホームへ戻る
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
