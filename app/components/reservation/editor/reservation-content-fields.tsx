import { useId } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { RESERVATION_MIN_HEAD_COUNT, RESERVATION_NOTE_MAX_LENGTH } from "~/domain/reservation";

/**
 * 予約の使用人数を入力する欄。
 *
 * 申請の欄（空き状況カレンダー）と予約の変更フォームの両方で同じものを使う。
 */
export function HeadCountField({
  value,
  onChange,
  error,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  error?: string;
}>) {
  const inputId = useId();
  const errorId = useId();

  return (
    <Field data-invalid={error !== undefined}>
      <FieldLabel htmlFor={inputId}>使用人数</FieldLabel>

      {/* 単位を添えて、数だけを入れればよいことを見せる。確認・控えの「4 名」と同じ単位にする */}
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          name="head_count"
          type="number"
          inputMode="numeric"
          required
          min={RESERVATION_MIN_HEAD_COUNT}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error !== undefined}
          aria-describedby={error !== undefined ? errorId : undefined}
          className="w-28"
        />
        <span className="text-sm text-muted-foreground">名</span>
      </div>

      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  );
}

/**
 * 予約の備考を入力する欄。
 *
 * 申請の欄（空き状況カレンダー）と予約の変更フォームの両方で同じものを使う。
 */
export function NoteField({
  value,
  onChange,
  error,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  error?: string;
}>) {
  const inputId = useId();
  const errorId = useId();

  return (
    <Field data-invalid={error !== undefined}>
      <div className="flex items-baseline justify-between gap-2">
        <FieldLabel htmlFor={inputId}>
          備考 <span className="font-normal text-muted-foreground">（任意）</span>
        </FieldLabel>

        <span className="text-xs text-muted-foreground tabular-nums">
          {value.length} / {RESERVATION_NOTE_MAX_LENGTH}
        </span>
      </div>

      <Textarea
        id={inputId}
        name="note"
        rows={3}
        maxLength={RESERVATION_NOTE_MAX_LENGTH}
        placeholder="利用目的や、事務局に伝えておきたいことがあれば書いてください。"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? errorId : undefined}
      />

      <FieldDescription>
        使用人数と備考は、申請した団体のメンバーと事務局にだけ公開されます。
      </FieldDescription>

      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  );
}
