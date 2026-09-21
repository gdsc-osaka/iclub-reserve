import { CircleAlert } from "lucide-react";
import { Form, useNavigation } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { GROUP_NAME_MAX_LENGTH } from "~/domain/group/group-name";

/** action から戻ってくる、フォームの状態 */
export interface GroupNameFormState {
  readonly submittedName: string;
  readonly nameError: string | null;
  readonly formError: string | null;
}

/**
 * 団体名編集フォーム。
 *
 * 管理者または事務局のみに表示され、団体名をインラインで変更できる。
 */
export function GroupNameForm({
  name,
  state,
}: Readonly<{ name: string; state: GroupNameFormState | null }>) {
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "update-group-name";

  return (
    <Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="update-group-name" />

      {/* 権限不足やサーバーエラーなどの全体エラー */}
      {state?.formError && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>保存できませんでした</AlertTitle>
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      )}

      {/*
        PC では 1 行に並べて右側にボタンを配置し、モバイルでは縦に積んでボタンを全幅にする。
      */}
      <div className="space-y-2">
        <Label htmlFor="group-name">団体名</Label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 min-w-0 space-y-1">
            <Input
              id="group-name"
              name="name"
              type="text"
              /*
               * 非制御入力として扱う。保存に失敗したときは入力された値をそのまま維持し、
               * 利用者に再度一から入力し直させないようにする。
               */
              defaultValue={state?.submittedName ?? name}
              /*
               * ブラウザ側でも入力を補助する。
               * ただしサーバー側の検証が本体であり、これらは入力時の手触りを向上させるためのもの。
               */
              required
              maxLength={GROUP_NAME_MAX_LENGTH}
              disabled={isSubmitting}
              aria-invalid={Boolean(state?.nameError)}
              aria-describedby={state?.nameError ? "group-name-error" : undefined}
            />
            {state?.nameError && (
              <p id="group-name-error" className="text-sm text-destructive">
                {state.nameError}
              </p>
            )}
          </div>

          <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
            {isSubmitting ? "保存中…" : "保存する"}
          </Button>
        </div>
      </div>
    </Form>
  );
}
