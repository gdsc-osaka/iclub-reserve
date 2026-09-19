import { Fragment, type ReactNode } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ALLOWED_EMAIL_DOMAINS_LABEL } from "~/domain/authn/allowed-email-domain";
import type { LoginMethod } from "~/domain/authn/login-method";

/**
 * メールアドレスを入力する段階。
 *
 * ログイン方法をここに並べる。どれを先に出すかは呼び出し元が決めた順（`methods`）に従う。
 * 並び順をここで決めないのは、前回使った方法をサーバー側で読んでいるため。
 */
export function EmailStep({
  methods,
  email,
  onEmailChange,
  pending,
  pendingMethod,
  onSubmitEmail,
  onPasskey,
}: Readonly<{
  methods: readonly LoginMethod[];
  email: string;
  onEmailChange: (email: string) => void;
  /** 何かの返事を待っているか。待っている間はどの操作も受け付けない */
  pending: boolean;
  /** どのログイン方法の返事を待っているか。押した側のボタンだけ文言を変える */
  pendingMethod: LoginMethod | null;
  onSubmitEmail: () => void;
  onPasskey: () => void;
}>) {
  const methodContents: Record<LoginMethod, ReactNode> = {
    "email-otp": (
      <EmailOtpForm
        email={email}
        onEmailChange={onEmailChange}
        pending={pending}
        isSending={pendingMethod === "email-otp"}
        onSubmit={onSubmitEmail}
      />
    ),
    passkey: (
      <PasskeyButton
        pending={pending}
        isVerifying={pendingMethod === "passkey"}
        onClick={onPasskey}
      />
    ),
  };

  return (
    <div className="space-y-4">
      {methods.map((method, index) => (
        <Fragment key={method}>
          {index > 0 && <MethodDivider />}
          {methodContents[method]}
        </Fragment>
      ))}
    </div>
  );
}

/** メールアドレスを入力して、認証コードを送ってもらうフォーム。 */
function EmailOtpForm({
  email,
  onEmailChange,
  pending,
  isSending,
  onSubmit,
}: Readonly<{
  email: string;
  onEmailChange: (email: string) => void;
  pending: boolean;
  isSending: boolean;
  onSubmit: () => void;
}>) {
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="email">メールアドレス</Label>
        <Input
          id="email"
          type="email"
          // 末尾の webauthn が、オートフィルにパスキーを出すための目印。
          // ブラウザはこの目印が付いた入力欄を探して候補を出すので、
          // 外すとオートフィルからのログインができなくなる。
          autoComplete="email webauthn"
          placeholder="example@osaka-u.ac.jp"
          required
          disabled={pending}
          value={email}
          onChange={(event) => onEmailChange(event.target.value)}
          aria-describedby="email-hint"
        />
        <p id="email-hint" className="text-xs text-muted-foreground">
          {ALLOWED_EMAIL_DOMAINS_LABEL} のメールアドレスのみご利用いただけます。
        </p>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {isSending ? "送信中…" : "メールアドレスで続ける"}
      </Button>
    </form>
  );
}

/**
 * パスキーでログインするボタン。
 *
 * 先頭に来ても見た目は変えない。塗りつぶしのボタンは
 * 「メールアドレスで続ける」に譲り、こちらは枠線だけにしておく。
 * 並び順で色まで入れ替わると、開くたびに画面の印象が変わってしまうため。
 */
function PasskeyButton({
  pending,
  isVerifying,
  onClick,
}: Readonly<{ pending: boolean; isVerifying: boolean; onClick: () => void }>) {
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        onClick={onClick}
        disabled={pending}
      >
        {isVerifying ? "確認中…" : "パスキーでログイン"}
      </Button>
      <p className="text-xs text-muted-foreground">
        登録済みの端末なら、顔認証・指紋・画面ロックだけでログインできます。
      </p>
    </div>
  );
}

/**
 * ログイン方法の間に挟む「または」の区切り。
 *
 * shadcn/ui のログイン画面の作例と同じく、横線の上に文字を重ねている。
 */
function MethodDivider() {
  return (
    <div className="relative text-center text-xs text-muted-foreground after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t">
      <span className="relative z-10 bg-card px-2">または</span>
    </div>
  );
}
