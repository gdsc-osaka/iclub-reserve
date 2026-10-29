import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { toReasonWithTemplate, type ReasonTemplate } from "~/domain/reservation/reason-templates";

export interface TransitionReasonFieldProps {
  readonly idPrefix: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly templates: readonly ReasonTemplate[];
  /** 説明の文 */
  readonly note: string;
}

/**
 * 予約を終える操作（却下・取り消し・キャンセル）で理由を入力する欄（COND-002）。
 *
 * 操作確認ダイアログと、重なりの解決ダイアログで共有する。
 */
export function TransitionReasonField({
  idPrefix,
  label,
  placeholder,
  value,
  onValueChange,
  templates,
  note,
}: Readonly<TransitionReasonFieldProps>) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`reason-${idPrefix}`} className="text-sm">
        {label}
        <span className="ml-1.5 text-xs font-semibold text-destructive">(必須)</span>
      </Label>
      {/* 定型文のボタン（事務局の却下・キャンセルだけ。COND-002） */}
      {templates.length > 0 && (
        <div
          role="group"
          aria-labelledby={`reason-templates-${idPrefix}`}
          className="flex flex-wrap items-center gap-1.5"
        >
          <span id={`reason-templates-${idPrefix}`} className="text-xs text-muted-foreground">
            定型文を入れる
          </span>
          {/*
            押した後にフォーカスを入力欄へ移さない。
            スマホでキーボードが出て、送信のボタン（「却下する」など）が隠れるため。
          */}
          {templates.map((template) => (
            <Button
              key={template.label}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onValueChange(toReasonWithTemplate(value, template.text))}
            >
              {template.label}
            </Button>
          ))}
        </div>
      )}
      <Textarea
        id={`reason-${idPrefix}`}
        name="reason"
        rows={3}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        required
        aria-describedby={`reason-note-${idPrefix}`}
        className="text-sm"
      />
      {/* 理由の欄を出す操作（取り消し・キャンセル・却下）は、どれも予約を終わらせる */}
      <p id={`reason-note-${idPrefix}`} className="text-xs text-muted-foreground">
        {note}
      </p>
    </div>
  );
}
