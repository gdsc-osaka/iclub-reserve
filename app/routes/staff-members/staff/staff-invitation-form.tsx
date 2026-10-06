import { CircleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { Form, useNavigation } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ALLOWED_EMAIL_DOMAINS_LABEL } from "~/domain/authn/allowed-email-domain";
import { INVITATION_EMAIL_MAX_LENGTH } from "~/domain/invitation/invitation-email";
import type { StaffInviteFormState } from "./action-data";

/**
 * 事務局招待作成フォーム。
 *
 * メールアドレスを入力して事務局への招待メールを送信する。
 */
export function StaffInvitationForm({ state }: Readonly<{ state: StaffInviteFormState | null }>) {
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state === "submitting" && navigation.formData?.get("intent") === "invite-staff";

  /*
   * 送信に成功したら、メールアドレスの欄を自分で空にする。
   */
  const emailRef = useRef<HTMLInputElement>(null);
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    if (isSubmitting) {
      hasSubmittedRef.current = true;
      return;
    }

    if (!hasSubmittedRef.current) return;
    hasSubmittedRef.current = false;

    if (state === null && emailRef.current !== null) {
      emailRef.current.value = "";
    }
  }, [isSubmitting, state]);

  return (
    <Form method="post" className="space-y-4">
      <input type="hidden" name="intent" value="invite-staff" />

      {/* 権限不足やサーバーエラーなどの全体エラー */}
      {state?.formError && (
        <Alert variant="destructive">
          <CircleAlert className="size-4" />
          <AlertTitle>招待を送れませんでした</AlertTitle>
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">事務局に招待</h3>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {/* メールアドレス入力欄 */}
          <div className="flex-1 min-w-0 space-y-1">
            <Label htmlFor="staff-invite-email" className="sr-only sm:not-sr-only text-xs">
              メールアドレス
            </Label>
            <Input
              ref={emailRef}
              id="staff-invite-email"
              name="email"
              type="email"
              placeholder="staff@osaka-u.ac.jp"
              defaultValue={state?.submittedEmail ?? ""}
              required
              maxLength={INVITATION_EMAIL_MAX_LENGTH}
              disabled={isSubmitting}
              aria-invalid={Boolean(state?.emailError)}
              aria-describedby={
                state?.emailError
                  ? "staff-invite-email-error staff-invite-email-hint"
                  : "staff-invite-email-hint"
              }
            />
            <p id="staff-invite-email-hint" className="text-xs text-muted-foreground">
              {`${ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスにのみ招待を送れます。`}
            </p>
            {state?.emailError && (
              <p id="staff-invite-email-error" className="text-sm text-destructive">
                {state.emailError}
              </p>
            )}
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
