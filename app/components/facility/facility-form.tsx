import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { FacilityField } from "~/domain/facility";
import { cn } from "~/lib/utils";

export interface FacilityFormValues {
  readonly name?: string;
  readonly description?: string | null;
  readonly googleCalendarId?: string | null;
  readonly calendarUrl?: string | null;
  readonly photoUrl?: string | null;
  readonly isActive?: boolean;
}

export interface FacilityFormProps {
  readonly mode: "create" | "edit";
  readonly initialValues?: FacilityFormValues;
  readonly errors?: {
    readonly [FacilityField.Name]?: string | null;
    readonly [FacilityField.Description]?: string | null;
    readonly [FacilityField.Photo]?: string | null;
    readonly [FacilityField.GoogleCalendarId]?: string | null;
    readonly formError?: string | null;
  };
  readonly isSubmitting?: boolean;
}

/**
 * 施設・設備の登録・編集共用フォーム。
 *
 * `encType="multipart/form-data"` による通常のフォーム送信で構成し、
 * JavaScript が無効な環境でも安全に動作する。
 */
export function FacilityForm({
  mode,
  initialValues = {},
  errors = {},
  isSubmitting = false,
}: Readonly<FacilityFormProps>) {
  return (
    <div className="flex flex-col gap-6">
      {/* フォーム全体のエラー */}
      {errors.formError && (
        <div
          role="alert"
          className="rounded-md bg-destructive/15 p-4 text-sm font-medium text-destructive"
        >
          {errors.formError}
        </div>
      )}

      {/* 施設名 */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={FacilityField.Name} className="font-medium">
          施設・設備名 <span className="text-destructive">*</span>
        </Label>
        <Input
          id={FacilityField.Name}
          name={FacilityField.Name}
          type="text"
          required
          maxLength={64}
          defaultValue={initialValues.name ?? ""}
          placeholder="例: 吹田：3Dプリンター 積層タイプ"
          aria-invalid={Boolean(errors[FacilityField.Name])}
          aria-describedby={errors[FacilityField.Name] ? "name-error" : undefined}
          className={cn(
            errors[FacilityField.Name] && "border-destructive focus-visible:ring-destructive",
          )}
        />
        {errors[FacilityField.Name] && (
          <p id="name-error" className="text-xs text-destructive">
            {errors[FacilityField.Name]}
          </p>
        )}
      </div>

      {/* 施設の説明 */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={FacilityField.Description} className="font-medium">
          説明（任意）
        </Label>
        <Textarea
          id={FacilityField.Description}
          name={FacilityField.Description}
          rows={4}
          maxLength={1000}
          defaultValue={initialValues.description ?? ""}
          placeholder="利用条件や設備仕様などを入力してください（改行可）"
          aria-invalid={Boolean(errors[FacilityField.Description])}
          aria-describedby={errors[FacilityField.Description] ? "description-error" : undefined}
          className={cn(
            errors[FacilityField.Description] &&
              "border-destructive focus-visible:ring-destructive",
          )}
        />
        {errors[FacilityField.Description] && (
          <p id="description-error" className="text-xs text-destructive">
            {errors[FacilityField.Description]}
          </p>
        )}
      </div>

      {/* 写真 */}
      <div className="flex flex-col gap-3">
        <Label htmlFor={FacilityField.Photo} className="font-medium">
          写真（任意）
        </Label>
        {mode === "edit" && initialValues.photoUrl && (
          <div className="flex items-center gap-4">
            <img
              src={initialValues.photoUrl}
              alt={initialValues.name ?? "施設写真"}
              className="h-24 w-24 rounded-md border object-cover"
            />
            <div className="flex items-center gap-2">
              <input
                id="remove_photo"
                name="remove_photo"
                type="checkbox"
                className="size-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Label htmlFor="remove_photo" className="text-sm cursor-pointer">
                現在の写真を外す
              </Label>
            </div>
          </div>
        )}
        <Input
          id={FacilityField.Photo}
          name={FacilityField.Photo}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-invalid={Boolean(errors[FacilityField.Photo])}
          aria-describedby={errors[FacilityField.Photo] ? "photo-error" : undefined}
          className={cn(
            "cursor-pointer file:cursor-pointer",
            errors[FacilityField.Photo] && "border-destructive focus-visible:ring-destructive",
          )}
        />
        <p className="text-xs text-muted-foreground">
          JPEG、PNG、WebP 形式（最大 5 MiB）に対応しています。
        </p>
        {errors[FacilityField.Photo] && (
          <p id="photo-error" className="text-xs text-destructive">
            {errors[FacilityField.Photo]}
          </p>
        )}
      </div>

      {/* Google Calendar ID */}
      <div className="flex flex-col gap-2">
        <Label htmlFor={FacilityField.GoogleCalendarId} className="font-medium">
          Google カレンダー ID（任意）
        </Label>
        <Input
          id={FacilityField.GoogleCalendarId}
          name={FacilityField.GoogleCalendarId}
          type="text"
          maxLength={255}
          defaultValue={initialValues.googleCalendarId ?? ""}
          placeholder="例: xxx@resource.calendar.google.com"
          aria-invalid={Boolean(errors[FacilityField.GoogleCalendarId])}
          aria-describedby={errors[FacilityField.GoogleCalendarId] ? "cal-id-error" : undefined}
          className={cn(
            errors[FacilityField.GoogleCalendarId] &&
              "border-destructive focus-visible:ring-destructive",
          )}
        />
        <p className="text-xs text-muted-foreground">
          施設用の Google カレンダー ID（@ を含む形式）を指定すると、iCal 購読用 URL
          が自動生成されます。
        </p>
        {errors[FacilityField.GoogleCalendarId] && (
          <p id="cal-id-error" className="text-xs text-destructive">
            {errors[FacilityField.GoogleCalendarId]}
          </p>
        )}
      </div>

      {/* カレンダー購読 URL（編集時のみ読み取り専用表示） */}
      {mode === "edit" && initialValues.calendarUrl && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="calendar_url" className="font-medium text-muted-foreground">
            カレンダー購読 URL（iCal形式・自動生成）
          </Label>
          <Input
            id="calendar_url"
            type="text"
            readOnly
            value={initialValues.calendarUrl}
            className="bg-muted text-muted-foreground select-all"
          />
        </div>
      )}

      {/* 登録時のみ: 有効/無効チェックボックス（既定は有効） */}
      {mode === "create" && (
        <div className="flex items-center gap-2 pt-2">
          <input
            id="is_active"
            name="is_active"
            type="checkbox"
            defaultChecked={initialValues.isActive ?? true}
            className="size-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <Label htmlFor="is_active" className="text-sm font-medium cursor-pointer">
            この施設をすぐに予約受付可能（有効）にする
          </Label>
        </div>
      )}

      {/* 送信ボタンとキャンセル */}
      <div className="flex items-center justify-end gap-4 pt-4 border-t">
        <Button variant="outline" asChild>
          <Link to="/staff/facilities">キャンセル</Link>
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting
            ? mode === "create"
              ? "登録中…"
              : "保存中…"
            : mode === "create"
              ? "登録する"
              : "保存する"}
        </Button>
      </div>
    </div>
  );
}
