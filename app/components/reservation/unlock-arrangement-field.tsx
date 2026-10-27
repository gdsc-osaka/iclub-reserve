import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { UnlockArrangement } from "~/domain/reservation";
import {
  parseUnlockArrangement,
  unlockArrangementLabel,
} from "~/domain/reservation/unlock-arrangement";

/**
 * 解錠の手配の選択肢の並び。手配が要る順（要手配 → 手配済み → 不要）にする。
 *
 * JavaScript が無いときの承認の送信（`ReservationActionDialog` の noscript）でも同じ並びを使う。
 */
export const unlockArrangementOptions = [
  UnlockArrangement.Required,
  UnlockArrangement.Arranged,
  UnlockArrangement.NotRequired,
] as const satisfies readonly UnlockArrangement[];

/** 選択肢の下に添える説明。選ぶと団体に何が案内されるかを、選ぶ前に分かるようにする（COND-027） */
const unlockArrangementDescription: Record<UnlockArrangement, string> = {
  [UnlockArrangement.Required]:
    "これから手配します。団体に、施錠されている可能性があると案内します。",
  [UnlockArrangement.Arranged]:
    "手配が済んでいます。団体に、方法をメッセージで確かめるよう案内します。",
  [UnlockArrangement.NotRequired]: "団体には何も案内しません。",
};

interface UnlockArrangementFieldProps {
  /**
   * 欄の中の要素の id の接頭辞。
   * 承認のダイアログは予約ごとに並ぶので、呼び出し側で予約ごとに違う値を渡す。
   */
  readonly idPrefix: string;
  /** 選んでいる値。まだ選んでいなければ null */
  readonly value: UnlockArrangement | null;
  readonly onValueChange: (value: UnlockArrangement) => void;
  /** サーバーが返した、この欄のエラー */
  readonly error?: string;
}

/**
 * 施設の解錠の手配（COND-027）を選ぶ欄。
 *
 * 承認のダイアログ（UC-006）と、予約申請・変更フォームの直接作成・直接変更（UC-008）で使う。
 * 既定値は置かない（どれも選んでいない状態から始める）。施錠される日時かどうかは事務局が
 * 予約ごとに判断するもので、既定値があると確かめずに送れてしまうため。
 *
 * フォームには `unlockArrangement` の名前で送る（Radix のラジオは、隠れた input を置いて送る）。
 */
export function UnlockArrangementField({
  idPrefix,
  value,
  onValueChange,
  error,
}: Readonly<UnlockArrangementFieldProps>) {
  const headingId = `${idPrefix}-heading`;
  const descriptionId = `${idPrefix}-description`;
  const errorId = `${idPrefix}-error`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <p id={headingId} className="text-sm font-medium">
          解錠の手配
          <span className="ml-1.5 text-xs font-semibold text-destructive">(必須)</span>
        </p>
        <p id={descriptionId} className="text-xs text-muted-foreground">
          建物の玄関や施設の部屋が施錠される日時かを確かめて選んでください。解錠の方法はメッセージで伝えてください。
        </p>
      </div>

      <RadioGroup
        name="unlockArrangement"
        value={value ?? ""}
        onValueChange={(next) => {
          const parsed = parseUnlockArrangement(next);
          if (parsed !== null) onValueChange(parsed);
        }}
        aria-labelledby={headingId}
        aria-describedby={error === undefined ? descriptionId : `${descriptionId} ${errorId}`}
        aria-required
        aria-invalid={error !== undefined}
      >
        {unlockArrangementOptions.map((option) => {
          const itemId = `${idPrefix}-${option}`;

          return (
            <div
              key={option}
              className="flex items-start gap-3 rounded-md border p-3 has-data-checked:border-primary has-data-checked:bg-primary/5"
            >
              <RadioGroupItem id={itemId} value={option} className="mt-0.5" />
              <div className="flex flex-col gap-1">
                <Label htmlFor={itemId}>{unlockArrangementLabel[option]}</Label>
                <p className="text-xs text-muted-foreground">
                  {unlockArrangementDescription[option]}
                </p>
              </div>
            </div>
          );
        })}
      </RadioGroup>

      {error !== undefined && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
