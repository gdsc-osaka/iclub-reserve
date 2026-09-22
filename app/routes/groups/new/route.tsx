import { env } from "cloudflare:workers";
import { CircleAlert, Clock } from "lucide-react";
import { useState } from "react";
import { Form, Link, redirect, useNavigation } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { GroupErrorCode } from "~/domain/group";
import { GROUP_NAME_MAX_LENGTH } from "~/domain/group/group-name";
import { createDb } from "~/infra/db";
import { createGroupRepository } from "~/infra/group/group-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import { toGroupErrorMessage } from "~/lib/group-error-message";
import { logServerError } from "~/lib/log.server";
import { createGroupUseCase } from "~/usecases/group/create-group";

import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "団体を登録 | iclub-reserve" }];
}

/**
 * 団体作成アクションのエラー・入力保持の形状。
 *
 * SCR-007 の GroupActionErrors とは分離し、この画面固有の型として定義する。
 */
export interface CreateGroupActionData {
  readonly submittedName: string;
  readonly nameError: string | null;
  readonly formError: string | null;
}

/**
 * 団体作成画面（SCR-006）のアクション。
 *
 * フォームから送信された団体名を検証し、新規団体と初期管理者のメンバーシップを登録する。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const formData = await request.formData();

  /*
   * この画面で行う操作は「団体の新規登録」の 1 つだけであるため、
   * SCR-007 のように複数の操作を識別するための intent の hidden フィールドは置かない。
   */
  const rawName = formData.get("name");
  const submittedName = typeof rawName === "string" ? rawName : "";

  const result = await createGroupUseCase(
    {
      groupRepository: createGroupRepository(createDb(env.DB)),
    },
    {
      actorUserId: user.id,
      name: submittedName,
      now: new Date(),
    },
  );

  if (result.isErr()) {
    const error = result.error;

    // 入力の誤りは利用者の操作に起因する想定内の事象であるためログには残さない。DB エラーのみログに記録する。
    if (error.code === GroupErrorCode.DatabaseError) {
      logServerError("groups.new.action", error);
    }

    const message = toGroupErrorMessage(error);

    return {
      submittedName,
      nameError: error.code === GroupErrorCode.GroupInvalidInput ? message : null,
      formError: error.code === GroupErrorCode.GroupInvalidInput ? null : message,
    } satisfies CreateGroupActionData;
  }

  /*
   * 作成完了後はダッシュボード（"/"）へ戻す（PRG パターン）。
   *
   * 【ダッシュボードへ戻す理由】
   * ダッシュボード（app/routes/home/route.tsx）には PendingGroupsNotice が実装されており、
   * 所属する承認待ち団体の一覧と「承認されるまで、この団体では予約を申請できません」という案内が
   * 作成した団体の名前付きで表示される。
   * これが BUC-010 の最後のステップ（作成完了と、有効化までは申請できない旨の表示）の要件を
   * そのまま満たすため、個別の完了画面を新設せずダッシュボードへリダイレクトする。
   */
  return redirect("/");
}

/**
 * 団体作成フォーム画面（SCR-006）。
 */
export default function CreateGroupRoute({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  /*
   * 送信して戻ってきたエラーを、利用者が団体名を打ち直した時点で消すための印。
   *
   * 消さずに残すと、直し終えた入力欄に赤い文言が出たままになるだけでなく、
   * `aria-invalid` も true のままになる。読み上げは正しく直した欄を
   * 「不正な入力」と言い続けるので、画面を見ずに使っている人には直したことが伝わらない。
   *
   * 送信のたびに false へ戻すのは、送信した値に対する新しいエラーは出したいため。
   */
  const [isNameEdited, setIsNameEdited] = useState(false);
  const nameError = isNameEdited ? null : (actionData?.nameError ?? null);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 md:py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold tracking-tight">団体を登録</CardTitle>
          <CardDescription>作成した人が、その団体の最初の管理者になります。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 送信前に出す案内（承認待ちに関する事前案内） */}
          <Alert className="border-amber-500/30 bg-amber-500/5">
            <Clock aria-hidden className="size-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle>登録後は事務局の承認を待ちます</AlertTitle>
            <AlertDescription>
              登録した団体は承認待ちの状態になります。事務局が承認するまで、この団体では予約を申請できません。
            </AlertDescription>
          </Alert>

          {/* サーバーエラー等の全体エラー */}
          {actionData?.formError && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden className="size-4" />
              <AlertTitle>登録できませんでした</AlertTitle>
              <AlertDescription>{actionData.formError}</AlertDescription>
            </Alert>
          )}

          <Form method="post" className="space-y-6" onSubmit={() => setIsNameEdited(false)}>
            <div className="space-y-2">
              <Label htmlFor="group-name">団体名</Label>
              {/*
               * 非制御入力として扱う。保存に失敗したときは入力された値をそのまま維持し、
               * 利用者に再度一から入力し直させないようにする。
               */}
              <Input
                id="group-name"
                name="name"
                type="text"
                defaultValue={actionData?.submittedName ?? ""}
                required
                maxLength={GROUP_NAME_MAX_LENGTH}
                disabled={isSubmitting}
                onChange={() => setIsNameEdited(true)}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "group-name-error" : undefined}
                placeholder="例: ロボティクス開発プロジェクト"
              />
              {nameError && (
                <p id="group-name-error" className="text-sm text-destructive">
                  {nameError}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button
                asChild
                variant="outline"
                className={isSubmitting ? "pointer-events-none opacity-50" : undefined}
              >
                <Link to="/">キャンセル</Link>
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "登録中…" : "登録する"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
