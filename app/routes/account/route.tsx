import { env } from "cloudflare:workers";
import { KeyRound, Laptop, Mail, ShieldAlert, User as UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { toast } from "sonner";

import { OtpCodeForm } from "~/components/auth/otp-code-form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  ALLOWED_EMAIL_DOMAINS_LABEL,
  isAllowedEmailAddress,
} from "~/domain/authn/allowed-email-domain";
import { isFreshSession } from "~/domain/authn/session-freshness";
import { validatePasskeyName, validateUserName } from "~/domain/authn/user-profile";
import { createDb } from "~/infra/db";
import { createAccountSettingsQuery } from "~/infra/user/account-settings-query";
import { createUserSessionRepository } from "~/infra/user/user-session-repo";
import { authClient } from "~/lib/auth/auth-client";
import { isPasskeyCancelledError, toAuthErrorMessage } from "~/lib/auth/auth-error-message";
import { ACCOUNT_PATH, LOGIN_PATH, withRedirectTo } from "~/lib/auth/auth-redirect";
import { getPasskeyRpId } from "~/lib/auth/auth-rp-id.server";
import { requireRequestSession, requireRequestUser } from "~/lib/auth/auth-session.server";
import { createSessionRevoker } from "~/lib/auth/session-revoker.server";
import { usePasskeySupport } from "~/lib/auth/passkey-support";
import { formatDateTime, formatFullDate } from "~/lib/date";
import type { AccountPasskeyItem, AccountSessionItem } from "~/query/user/account-settings";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import { userActionErrors } from "~/routes/_shared/user-error.server";
import {
  revokeOtherSessionsUseCase,
  revokeSessionUseCase,
} from "~/usecases/user/revoke-user-session";

import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "アカウント設定 | iclub-reserve" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);
  const session = requireRequestSession(context);

  const db = createDb(env.DB);
  const query = createAccountSettingsQuery(db);
  const result = await query.findByUserId(user.id, session.id, new Date());

  if (result.isErr()) {
    throw queryErrorResponse({ where: "account.loader", userId: user.id }, result.error);
  }

  const canAddPasskey = isFreshSession(session.createdAt, new Date());
  const rpId = getPasskeyRpId();

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    canAddPasskey,
    rpId,
    passkeys: result.value.passkeys,
    sessions: result.value.sessions,
  };
}

/**
 * action が画面へ返す結果。
 *
 * 成功したら `message` に知らせる文言を、失敗したら `formError` に誤りを入れる。
 * 一覧はローダーが読み直すので、ここでは返さない。
 */
type AccountActionData = {
  readonly message: string | null;
  readonly formError: string | null;
};

/**
 * ログイン中の端末のログアウト（UC-031）。
 *
 * パスキーや氏名などほかの操作は、ブラウザから Better Auth を直接呼ぶ。
 * ログアウトだけをここで受けるのは、終わらせるにはセッションのトークンが要り、
 * それをブラウザへ渡さないため（実装課題 8）。画面へは ID だけを出し、トークンはサーバーで引く。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const session = requireRequestSession(context);

  const formData = await request.formData();
  const intent = formData.get("intent");

  const contextOf = (operation: string) => ({ where: `account.${operation}`, userId: user.id });
  const sessionRevoker = createSessionRevoker(request.headers);

  if (intent === "revoke-session") {
    const rawSessionId = formData.get("sessionId");

    const result = await revokeSessionUseCase(
      {
        userSessionRepository: createUserSessionRepository(createDb(env.DB)),
        sessionRevoker,
      },
      {
        userId: user.id,
        sessionId: typeof rawSessionId === "string" ? rawSessionId : "",
        currentSessionId: session.id,
      },
    );

    if (result.isErr()) {
      return {
        message: null,
        ...userActionErrors(contextOf("revoke-session"), result.error),
      } satisfies AccountActionData;
    }

    return { message: "端末をログアウトしました。", formError: null } satisfies AccountActionData;
  }

  if (intent === "revoke-other-sessions") {
    const result = await revokeOtherSessionsUseCase({ sessionRevoker });

    if (result.isErr()) {
      return {
        message: null,
        ...userActionErrors(contextOf("revoke-other-sessions"), result.error),
      } satisfies AccountActionData;
    }

    return {
      message: "この端末以外をすべてログアウトしました。",
      formError: null,
    } satisfies AccountActionData;
  }

  // この画面が出している操作以外は受け付けない
  return { message: null, formError: "不正な操作です。" } satisfies AccountActionData;
}

export default function AccountSettingsRoute({ loaderData }: Route.ComponentProps) {
  const { user, canAddPasskey, rpId, passkeys, sessions } = loaderData;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight">アカウント設定</h1>
        <p className="text-sm text-muted-foreground">
          氏名、メールアドレス、ログイン方法、およびログイン中の端末を管理します。
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <ProfileNameCard currentName={user.name} />
        <EmailCard currentEmail={user.email} />
        <PasskeyCard passkeys={passkeys} canAddPasskey={canAddPasskey} rpId={rpId} />
        <SessionsCard sessions={sessions} />
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// 1. 氏名カード (UC-029)
// ---------------------------------------------------------------------------
function ProfileNameCard({ currentName }: Readonly<{ currentName: string }>) {
  const revalidator = useRevalidator();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(currentName);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setName(currentName);
  }, [currentName]);

  const handleStartEdit = () => {
    setName(currentName);
    setErrorText(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setName(currentName);
    setErrorText(null);
    setIsEditing(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    const validation = validateUserName(name);
    if (validation.isErr()) {
      setErrorText(validation.error.userMessage);
      return;
    }

    setPending(true);
    const { error } = await authClient.updateUser({ name: validation.value });
    setPending(false);

    if (error) {
      toast.error(toAuthErrorMessage(error, "氏名の更新に失敗しました。"));
      return;
    }

    toast.success("氏名を更新しました。");
    setIsEditing(false);
    revalidator.revalidate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <UserIcon aria-hidden className="size-4 text-muted-foreground" />
          氏名
        </CardTitle>
        <CardDescription>
          予約画面や所属団体などで他の利用者に表示されるお名前です。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <form onSubmit={handleSave} className="max-w-md space-y-4">
            <div className="space-y-2">
              <Label htmlFor="user-name">お名前（本名）</Label>
              <Input
                id="user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="大阪 太郎"
                disabled={pending}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                事務局が利用者を確かめられるよう、ニックネームではなく本名を入力してください。
              </p>
              {errorText && <p className="text-sm font-medium text-destructive">{errorText}</p>}
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending} size="sm">
                {pending ? "保存中…" : "保存"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                size="sm"
                onClick={handleCancel}
              >
                キャンセル
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-base font-medium">{currentName}</span>
            <Button variant="outline" size="sm" onClick={handleStartEdit}>
              変更
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 2. メールアドレスカード (UC-023 / SCR-017)
// ---------------------------------------------------------------------------
function EmailCard({ currentEmail }: Readonly<{ currentEmail: string }>) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Mail aria-hidden className="size-4 text-muted-foreground" />
          メールアドレス
        </CardTitle>
        <CardDescription>
          ログインおよびシステムからの各種通知に使用されるメールアドレスです。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <span className="text-base font-medium">{currentEmail}</span>
        <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
          変更
        </Button>
        <EmailChangeDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          currentEmail={currentEmail}
        />
      </CardContent>
    </Card>
  );
}

function EmailChangeDialog({
  open,
  onOpenChange,
  currentEmail,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentEmail: string;
}>) {
  const revalidator = useRevalidator();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [newEmail, setNewEmail] = useState("");
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const resetState = () => {
    setStep(1);
    setNewEmail("");
    setErrorText(null);
    setPending(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetState();
    }
    onOpenChange(nextOpen);
  };

  // Step 1: 送信
  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText(null);

    const trimmed = newEmail.trim();
    if (trimmed === "") {
      setErrorText("新しいメールアドレスを入力してください。");
      return;
    }
    if (trimmed.toLowerCase() === currentEmail.toLowerCase()) {
      setErrorText("現在のメールアドレスと同じです。");
      return;
    }
    if (!isAllowedEmailAddress(trimmed)) {
      setErrorText(`${ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスを入力してください。`);
      return;
    }

    setPending(true);
    const { error } = await authClient.emailOtp.sendVerificationOtp({
      email: currentEmail,
      type: "email-verification",
    });
    setPending(false);

    if (error) {
      setErrorText(toAuthErrorMessage(error, "認証コードの送信に失敗しました。"));
      return;
    }

    setStep(2);
  };

  // Step 2: 現在のアドレスの OTP 検証
  const handleStep2Submit = async (otp: string) => {
    setErrorText(null);
    setPending(true);

    const { error } = await authClient.emailOtp.requestEmailChange({
      newEmail: newEmail.trim(),
      otp,
    });
    setPending(false);

    if (error) {
      setErrorText(toAuthErrorMessage(error, "認証コードが正しくないか、期限切れです。"));
      return;
    }

    setStep(3);
  };

  // Step 3: 新しいアドレスの OTP 検証
  const handleStep3Submit = async (otp: string) => {
    setErrorText(null);
    setPending(true);

    const { error } = await authClient.emailOtp.changeEmail({
      newEmail: newEmail.trim(),
      otp,
    });
    setPending(false);

    if (error) {
      setErrorText(toAuthErrorMessage(error, "認証コードが正しくないか、期限切れです。"));
      return;
    }

    toast.success("メールアドレスを変更しました。");
    handleOpenChange(false);
    revalidator.revalidate();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 1 && "メールアドレスの変更 (1/3)"}
            {step === 2 && "現在のアドレスでの確認 (2/3)"}
            {step === 3 && "新しいアドレスでの確認 (3/3)"}
          </DialogTitle>
          <DialogDescription>
            {step === 1 && "新しく設定したい大阪大学のメールアドレスを入力してください。"}
            {step === 2 && "本人確認のため、現在のアドレスへ届いた認証コードを入力してください。"}
            {step === 3 && "新しいメールアドレスへ届いた認証コードを入力してください。"}
          </DialogDescription>
        </DialogHeader>

        {errorText && (
          <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            {errorText}
          </div>
        )}

        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-email">新しいメールアドレス</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="user@osaka-u.ac.jp"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                disabled={pending}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                {ALLOWED_EMAIL_DOMAINS_LABEL} のアドレスがご利用いただけます。
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={pending}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={pending || newEmail.trim() === ""}>
                {pending ? "送信中…" : "次へ（認証コード送信）"}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <OtpCodeForm
              email={currentEmail}
              pending={pending}
              submitLabel="次へ"
              onSubmit={(otp) => void handleStep2Submit(otp)}
              onResend={async () => {
                setErrorText(null);
                setPending(true);
                const { error } = await authClient.emailOtp.sendVerificationOtp({
                  email: currentEmail,
                  type: "email-verification",
                });
                setPending(false);
                if (error) {
                  setErrorText(toAuthErrorMessage(error, "再送信に失敗しました。"));
                } else {
                  toast.info("認証コードを再送信しました。");
                }
              }}
              onBack={() => {
                setErrorText(null);
                setStep(1);
              }}
            />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              ※コードが届かない場合、そのアドレスは既に別のアカウントで使われている可能性があります。
            </p>
            <OtpCodeForm
              email={newEmail.trim()}
              pending={pending}
              submitLabel="変更を完了する"
              onSubmit={(otp) => void handleStep3Submit(otp)}
              onResend={async () => {
                /*
                 * 新しいアドレスへのコードは、現在のアドレスのコードと引き換えにしか送れない。
                 * そのコードは 2 段階目で使い切っているので、現在のアドレスでの確認からやり直す。
                 */
                setErrorText(null);
                setPending(true);
                const { error } = await authClient.emailOtp.sendVerificationOtp({
                  email: currentEmail,
                  type: "email-verification",
                });
                setPending(false);
                if (error) {
                  setErrorText(toAuthErrorMessage(error, "認証コードを送れませんでした。"));
                  return;
                }
                toast.info(
                  "送り直すには、現在のアドレスでの確認からやり直す必要があります。現在のアドレスへ認証コードを送りました。",
                );
                setStep(2);
              }}
              onBack={() => {
                setErrorText(null);
                setStep(2);
              }}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 3. パスキーカード (UC-021 / UC-030)
// ---------------------------------------------------------------------------
function PasskeyCard({
  passkeys,
  canAddPasskey,
  rpId,
}: Readonly<{
  passkeys: readonly AccountPasskeyItem[];
  canAddPasskey: boolean;
  rpId: string;
}>) {
  const revalidator = useRevalidator();
  const passkeySupport = usePasskeySupport();
  const [isFresh, setIsFresh] = useState(canAddPasskey);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [pendingRename, setPendingRename] = useState(false);
  const [addingPasskey, setAddingPasskey] = useState(false);

  useEffect(() => {
    setIsFresh(canAddPasskey);
  }, [canAddPasskey]);

  const handleStartRename = (pk: AccountPasskeyItem) => {
    setRenamingId(pk.id);
    setRenameValue(pk.label);
    setRenameError(null);
  };

  const handleSaveRename = async (id: string) => {
    setRenameError(null);
    const validation = validatePasskeyName(renameValue);
    if (validation.isErr()) {
      setRenameError(validation.error.userMessage);
      return;
    }

    setPendingRename(true);
    const { error } = await authClient.passkey.updatePasskey({ id, name: validation.value });
    setPendingRename(false);

    if (error) {
      toast.error(toAuthErrorMessage(error, "パスキー名の変更に失敗しました。"));
      return;
    }

    toast.success("パスキー名を変更しました。");
    setRenamingId(null);
    revalidator.revalidate();
  };

  const handleDeletePasskey = async (pk: AccountPasskeyItem) => {
    const { error } = await authClient.passkey.deletePasskey({ id: pk.id });
    if (error) {
      toast.error(toAuthErrorMessage(error, "パスキーの削除に失敗しました。"));
      return;
    }

    // WebAuthn Signal API: 端末側の認証情報削除の通知を試みる（ブラウザが対応している場合のみ）
    if (
      typeof PublicKeyCredential !== "undefined" &&
      "signalUnknownCredential" in PublicKeyCredential &&
      typeof (PublicKeyCredential as unknown as { signalUnknownCredential: unknown })
        .signalUnknownCredential === "function"
    ) {
      try {
        await (
          PublicKeyCredential as unknown as {
            signalUnknownCredential: (opts: {
              rpId: string;
              credentialId: string;
            }) => Promise<void>;
          }
        ).signalUnknownCredential({
          rpId,
          credentialId: pk.credentialID,
        });
      } catch {
        // 失敗は無視する
      }
    }

    toast.success("パスキーを削除しました。");
    revalidator.revalidate();
  };

  const handleAddPasskey = async () => {
    setAddingPasskey(true);
    // 名前を渡さずに呼ぶことでサーバー側（registration.afterVerification）で命名させる
    const { error } = await authClient.passkey.addPasskey();
    setAddingPasskey(false);

    if (error) {
      if (isPasskeyCancelledError(error)) return;
      if ("code" in error && error.code === "SESSION_NOT_FRESH") {
        setIsFresh(false);
        return;
      }
      toast.error(toAuthErrorMessage(error, "パスキーの追加に失敗しました。"));
      return;
    }

    toast.success("パスキーを登録しました。");
    revalidator.revalidate();
  };

  const handleReLogin = async () => {
    await authClient.signOut();
    window.location.href = withRedirectTo(LOGIN_PATH, ACCOUNT_PATH);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <KeyRound aria-hidden className="size-4 text-muted-foreground" />
          パスキー
        </CardTitle>
        <CardDescription>生体認証や画面ロックを使ったパスキーを登録・管理します。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {passkeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">登録されているパスキーはありません。</p>
        ) : (
          <div className="divide-y rounded-md border">
            {passkeys.map((pk) => (
              <div
                key={pk.id}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  {renamingId === pk.id ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        disabled={pendingRename}
                        className="h-8 max-w-xs text-sm"
                        autoFocus
                      />
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          className="h-8 px-2 text-xs"
                          disabled={pendingRename}
                          onClick={() => void handleSaveRename(pk.id)}
                        >
                          保存
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          disabled={pendingRename}
                          onClick={() => setRenamingId(null)}
                        >
                          キャンセル
                        </Button>
                      </div>
                      {renameError && (
                        <p className="text-xs font-medium text-destructive">{renameError}</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{pk.label}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-1.5 text-xs text-muted-foreground"
                        onClick={() => handleStartRename(pk)}
                      >
                        名前を変更
                      </Button>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>登録日時: {pk.createdAt ? formatDateTime(pk.createdAt) : "—"}</span>
                    <span>
                      最後に使った日時:{" "}
                      {pk.lastUsedAt ? formatDateTime(pk.lastUsedAt) : "まだ使っていません"}
                    </span>
                    <span>{pk.backedUp ? "同期される" : "同期されない（登録した認証器だけ）"}</span>
                  </div>
                </div>

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start text-destructive hover:bg-destructive/10 sm:self-center"
                    >
                      削除
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>パスキーを削除しますか？</AlertDialogTitle>
                      <AlertDialogDescription className="space-y-2">
                        <span>「{pk.label}」を削除します。</span>
                        <span className="block">
                          削除後も、端末やパスワードマネージャーに保存されたパスキーは自動で消えないため、ご自身で端末の設定から削除してください。
                        </span>
                        <span className="block">
                          すべてのパスキーを削除した場合でも、メールの認証コードでログインできます。
                        </span>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>キャンセル</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => void handleDeletePasskey(pk)}
                      >
                        削除する
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}

        {/* パスキー追加導線 */}
        {passkeySupport.status === "unsupported" ? (
          <p className="text-sm text-muted-foreground">
            このブラウザはパスキーに対応していません。
          </p>
        ) : passkeySupport.status === "unknown" ? null : !isFresh ? (
          <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                最後のログインから 24
                時間以上たっているため、安全のためもう一度ログインしてから追加してください。
              </span>
            </div>
            <div>
              <Button variant="outline" size="sm" onClick={() => void handleReLogin()}>
                もう一度ログイン
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={addingPasskey}
              onClick={() => void handleAddPasskey()}
            >
              {addingPasskey ? "パスキーを追加中…" : "パスキーを追加"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 4. ログイン中の端末カード (UC-031)
// ---------------------------------------------------------------------------
function SessionsCard({ sessions }: Readonly<{ sessions: readonly AccountSessionItem[] }>) {
  const fetcher = useFetcher<typeof action>();

  // 結果はトーストで知らせる。ログアウトさせた行は、読み直した一覧から消える
  useEffect(() => {
    if (fetcher.data?.formError) {
      toast.error(fetcher.data.formError);
    } else if (fetcher.data?.message) {
      toast.success(fetcher.data.message);
    }
  }, [fetcher.data]);

  const otherSessions = sessions.filter((s) => !s.isCurrent);
  const isRevoking = fetcher.state !== "idle";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Laptop aria-hidden className="size-4 text-muted-foreground" />
          ログイン中の端末
        </CardTitle>
        <CardDescription>
          現在ログインしている端末の一覧です。身に覚えのない端末や使わなくなった端末からログアウトできます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="divide-y rounded-md border">
          {sessions.map((sess) => (
            <div
              key={sess.id}
              className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{sess.deviceName}</span>
                  {sess.isCurrent && (
                    <Badge variant="secondary" className="text-xs">
                      この端末
                    </Badge>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>ログインした日時: {formatDateTime(sess.createdAt)}</span>
                  <span>最後に使った日: {formatFullDate(sess.updatedAt)}</span>
                </div>
              </div>

              {!sess.isCurrent && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isRevoking}
                      className="self-start text-destructive hover:bg-destructive/10 sm:self-center"
                    >
                      ログアウト
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>端末からログアウトしますか？</AlertDialogTitle>
                      <AlertDialogDescription>
                        「{sess.deviceName}
                        」をログアウトします。この端末で再度利用するにはログインが必要になります。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>キャンセル</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => {
                          fetcher.submit(
                            { intent: "revoke-session", sessionId: sess.id },
                            { method: "post" },
                          );
                        }}
                      >
                        ログアウトする
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          ))}
        </div>

        {otherSessions.length > 0 && (
          <div className="flex justify-end">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" disabled={isRevoking}>
                  この端末以外をすべてログアウト
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>他のすべての端末からログアウトしますか？</AlertDialogTitle>
                  <AlertDialogDescription>
                    現在利用中のこの端末以外の、他のすべての端末（{otherSessions.length}
                    台）からログアウトします。
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>キャンセル</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => {
                      fetcher.submit({ intent: "revoke-other-sessions" }, { method: "post" });
                    }}
                  >
                    ログアウトする
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
