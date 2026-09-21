import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { Form, useNavigation } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { ALLOWED_EMAIL_DOMAINS_LABEL } from "~/domain/authn/allowed-email-domain";
import { INVITATION_EMAIL_MAX_LENGTH } from "~/domain/invitation/invitation-email";
import { isMembershipRole, MembershipRole, membershipRoleLabel } from "~/domain/membership";

/** action から戻ってくる、招待フォームの状態 */
export interface GroupInviteFormState {
  readonly submittedEmail: string;
  readonly submittedRole: string;
  readonly emailError: string | null;
  readonly formError: string | null;
}

/**
 * 招待作成フォーム。
 *
 * 管理者または事務局スタッフ向けに表示され、メールアドレスと役割を指定して
 * 団体へのメンバー招待メールを送信する。
 */
export function InvitationForm({ state }: Readonly<{ state: GroupInviteFormState | null }>) {
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "invite-member";

  /*
   * 役割選択の初期値:
   * 前回復帰値が有効な MembershipRole であればそれを使用し、それ以外は Member を既定値とする。
   * 管理者（Admin）を既定値にすると、操作者が選択し忘れた場合に意図せず強い権限を付与してしまう
   * 恐れがあるため、安全側に倒して Member を既定としている。
   */
  const initialRole =
    state?.submittedRole && isMembershipRole(state.submittedRole)
      ? state.submittedRole
      : MembershipRole.Member;
  const [role, setRole] = useState<string>(initialRole);

  return (
    <Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="invite-member" />

      {/* 権限不足やサーバーエラーなどの全体エラー */}
      {state?.formError && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>招待を送れませんでした</AlertTitle>
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">メンバーを招待</h3>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* メールアドレス入力欄 */}
          <div className="flex-1 min-w-0 space-y-1">
            <Label htmlFor="invite-email" className="sr-only sm:not-sr-only text-xs">
              メールアドレス
            </Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              placeholder="taro@osaka-u.ac.jp"
              /*
               * 非制御入力として扱う。送信失敗時に入力値を維持し、一から再入力させないため。
               */
              defaultValue={state?.submittedEmail ?? ""}
              required
              maxLength={INVITATION_EMAIL_MAX_LENGTH}
              disabled={isSubmitting}
              aria-invalid={Boolean(state?.emailError)}
              aria-describedby={
                state?.emailError ? "invite-email-error invite-email-hint" : "invite-email-hint"
              }
            />
            <p id="invite-email-hint" className="text-xs text-muted-foreground">
              {`${ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスにのみ招待を送れます。`}
            </p>
            {state?.emailError && (
              <p id="invite-email-error" className="text-sm text-destructive">
                {state.emailError}
              </p>
            )}
          </div>

          {/* 役割選択 */}
          <div className="w-full sm:w-36 space-y-1">
            <Label htmlFor="invite-role" className="sr-only sm:not-sr-only text-xs">
              役割
            </Label>
            {/*
             * Radix UI の Select は制御コンポーネントとして扱い、
             * フォーム送信用の hidden input を自動で埋め込む。
             */}
            <Select
              name="role"
              required
              value={role}
              onValueChange={setRole}
              disabled={isSubmitting}
            >
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue placeholder="役割を選択" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={MembershipRole.Member}>
                    {membershipRoleLabel[MembershipRole.Member]}
                  </SelectItem>
                  <SelectItem value={MembershipRole.Admin}>
                    {membershipRoleLabel[MembershipRole.Admin]}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* 送信ボタン */}
          <div className="pt-0 sm:pt-5">
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? "送信中…" : "招待する"}
            </Button>
          </div>
        </div>
      </div>
    </Form>
  );
}
