import { REGEXP_ONLY_DIGITS } from "input-otp";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "~/components/ui/input-otp";
import { Label } from "~/components/ui/label";

/**
 * 認証コードの桁数。
 * Better Auth の emailOTP プラグインの既定値（6 桁）に合わせている。
 */
export const OTP_LENGTH = 6;

type OtpCodeFormProps = {
  /** 認証コードの送信先。入力し間違いに気付けるよう画面にも表示する。 */
  email: string;
  /** 通信中は true。ボタンを押せないようにする。 */
  pending: boolean;
  /** 送信ボタンのラベル。画面によって「ログイン」「登録して始める」と変える。 */
  submitLabel: string;
  /** 入力された認証コードを受け取る。 */
  onSubmit: (otp: string) => void;
  /** 認証コードを再送する。 */
  onResend: () => void;
  /** メールアドレスの入力に戻る。 */
  onBack: () => void;
};

/**
 * メールで届いた認証コードを入力するフォーム。
 *
 * ログイン画面と新規登録画面のどちらでも同じ見た目・操作になるよう、
 * 2 段階目の入力だけをこのコンポーネントに切り出している。
 */
export function OtpCodeForm({
  email,
  pending,
  submitLabel,
  onSubmit,
  onResend,
  onBack,
}: Readonly<OtpCodeFormProps>) {
  const [otp, setOtp] = useState("");

  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(otp);
      }}
    >
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{email}</span> 宛に{OTP_LENGTH}
        桁の認証コードを送信しました。メールを確認して入力してください。
      </p>

      <div className="space-y-2">
        <Label htmlFor="otp">認証コード</Label>
        <InputOTP
          id="otp"
          value={otp}
          onChange={setOtp}
          maxLength={OTP_LENGTH}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode="numeric"
          autoFocus
          disabled={pending}
          containerClassName="justify-center"
        >
          <InputOTPGroup>
            {Array.from({ length: OTP_LENGTH }, (_, index) => (
              // 桁ごとの枠。桁数は固定で並び替えも起きないため key には index を使う。
              <InputOTPSlot key={index} index={index} className="size-11 text-base" />
            ))}
          </InputOTPGroup>
        </InputOTP>
      </div>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={pending || otp.length < OTP_LENGTH}
      >
        {submitLabel}
      </Button>

      <div className="flex items-center justify-between">
        <Button type="button" variant="link" size="sm" onClick={onBack} disabled={pending}>
          メールアドレスを変更
        </Button>
        <Button type="button" variant="link" size="sm" onClick={onResend} disabled={pending}>
          認証コードを再送信
        </Button>
      </div>
    </form>
  );
}
