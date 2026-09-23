import { env } from "cloudflare:workers";
import { CircleAlert } from "lucide-react";
import { useEffect } from "react";
import { Form, isRouteErrorResponse, Link, useNavigation } from "react-router";
import { toast } from "sonner";

import { FacilityForm, type FacilityFormProps } from "~/components/facility/facility-form";
import {
  FacilityStatusBadge,
  facilityStatusLabel,
} from "~/components/facility/facility-status-badge";
import { FacilityStatusDialog } from "~/components/facility/facility-status-dialog";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { FacilityField } from "~/domain/facility";
import { createDb } from "~/infra/db";
import { createR2FacilityPhotoStorage } from "~/infra/facility/r2-facility-photo-storage";
import { createFacilityRepository } from "~/infra/facility/facility-repo";
import { requireRequestUser } from "~/lib/auth/auth-session.server";
import {
  facilityActionErrors,
  facilityErrorResponse,
} from "~/routes/_shared/facility-error.server";
import { changeFacilityStatusUseCase } from "~/usecases/facility/change-facility-status";
import { getFacilityUseCase } from "~/usecases/facility/get-facility";
import { updateFacilityUseCase } from "~/usecases/facility/update-facility";

import type { Route } from "./+types/route";

export function meta({ loaderData }: Route.MetaArgs) {
  const facilityName = loaderData?.facility?.name ?? "施設";
  return [{ title: `${facilityName} の編集 | iclub-reserve` }];
}

const MAX_CONTENT_LENGTH_BYTES = 6 * 1024 * 1024;

/**
 * 施設編集画面のローダー。
 *
 * 事務局スタッフ限定（COND-009）。
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);
  const facilityId = params.facilityId;

  const db = createDb(env.DB);
  const result = await getFacilityUseCase(
    { facilityRepository: createFacilityRepository(db) },
    {
      facilityId,
      actorUserId: user.id,
      isStaff: user.is_staff,
    },
  );

  if (result.isErr()) {
    throw facilityErrorResponse(
      { where: "staff.facilities.detail.loader", userId: user.id },
      result.error,
    );
  }

  return { facility: result.value };
}

/**
 * 施設情報の更新・状態変更アクション（UC-015 / UC-016）。
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);
  const facilityId = params.facilityId;

  const intent =
    new URL(request.url).searchParams.get("intent") ??
    (await request.clone().formData()).get("intent");

  const db = createDb(env.DB);

  if (intent === "change-status") {
    const formData = await request.formData();
    const rawStatus = formData.get("status");
    const status = typeof rawStatus === "string" ? rawStatus : "";

    const result = await changeFacilityStatusUseCase(
      { facilityRepository: createFacilityRepository(db) },
      {
        facilityId,
        actorUserId: user.id,
        isStaff: user.is_staff,
        status,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      return facilityActionErrors(
        { where: "staff.facilities.detail.change-status", userId: user.id },
        result.error,
      );
    }

    return {
      success: {
        kind: "change-status" as const,
        message: `${result.value.name} を${facilityStatusLabel(result.value.isActive)}にしました。`,
      },
    };
  }

  // 施設情報の更新（intent === "update"）
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_CONTENT_LENGTH_BYTES) {
    return {
      [FacilityField.Photo]: "送信サイズが大きすぎます（上限 5 MiB）。",
      formError: "送信されたデータが上限を超えています。",
    };
  }

  const formData = await request.formData();
  const rawName = formData.get(FacilityField.Name);
  const rawDescription = formData.get(FacilityField.Description);
  const rawGoogleCalendarId = formData.get(FacilityField.GoogleCalendarId);
  const photo = formData.get(FacilityField.Photo) as File | null;
  const removePhoto = formData.get("remove_photo") === "on";

  const name = typeof rawName === "string" ? rawName : "";
  const description = typeof rawDescription === "string" ? rawDescription : null;
  const googleCalendarId = typeof rawGoogleCalendarId === "string" ? rawGoogleCalendarId : null;

  const photoStorage = createR2FacilityPhotoStorage(env.MEDIA);
  const result = await updateFacilityUseCase(
    {
      facilityRepository: createFacilityRepository(db),
      facilityPhotoStorage: photoStorage,
    },
    {
      facilityId,
      actorUserId: user.id,
      isStaff: user.is_staff,
      name,
      description,
      googleCalendarId,
      photo,
      removePhoto,
      now: new Date(),
    },
  );

  if (result.isErr()) {
    return facilityActionErrors(
      { where: "staff.facilities.detail.update", userId: user.id },
      result.error,
      {
        [FacilityField.Name]: FacilityField.Name,
        [FacilityField.Description]: FacilityField.Description,
        [FacilityField.Photo]: FacilityField.Photo,
        [FacilityField.GoogleCalendarId]: FacilityField.GoogleCalendarId,
      },
    );
  }

  return {
    success: {
      kind: "update" as const,
      message: "施設情報を保存しました。",
    },
  };
}

export default function EditFacilityPage({ loaderData, actionData }: Route.ComponentProps) {
  const { facility } = loaderData;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  useEffect(() => {
    if (!actionData) {
      return;
    }
    if ("success" in actionData && actionData.success) {
      toast.success(actionData.success.message);
    } else if ("formError" in actionData && actionData.formError) {
      toast.error(actionData.formError, { duration: 10_000 });
    }
  }, [actionData]);

  const formErrors: FacilityFormProps["errors"] =
    actionData && !("success" in actionData)
      ? {
          [FacilityField.Name]:
            "facility_name" in actionData && typeof actionData.facility_name === "string"
              ? actionData.facility_name
              : null,
          [FacilityField.Description]:
            "facility_description" in actionData &&
            typeof actionData.facility_description === "string"
              ? actionData.facility_description
              : null,
          [FacilityField.Photo]:
            "facility_photo" in actionData && typeof actionData.facility_photo === "string"
              ? actionData.facility_photo
              : null,
          [FacilityField.GoogleCalendarId]:
            "google_calendar_id" in actionData && typeof actionData.google_calendar_id === "string"
              ? actionData.google_calendar_id
              : null,
          formError:
            "formError" in actionData && typeof actionData.formError === "string"
              ? actionData.formError
              : null,
        }
      : undefined;

  return (
    <div className="flex flex-col gap-8 p-4 md:p-8 max-w-3xl mx-auto w-full">
      {/* 見出し */}
      <div className="flex flex-col gap-1">
        <div className="text-sm text-muted-foreground mb-1">
          <Link to="/staff/facilities" className="hover:underline">
            ← 施設管理一覧に戻る
          </Link>
        </div>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">{facility.name} の編集</h1>
          <FacilityStatusBadge isActive={facility.isActive} />
        </div>
      </div>

      {/* 基本情報フォーム */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">施設情報</CardTitle>
          <CardDescription>
            施設・設備の名称、説明文、写真、Google カレンダー連携を設定します。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="intent" value="update" />
            <FacilityForm
              mode="edit"
              initialValues={facility}
              errors={formErrors}
              isSubmitting={isSubmitting}
            />
          </Form>
        </CardContent>
      </Card>

      {/* 状態管理セクション */}
      <Card className="border-muted-foreground/20">
        <CardHeader>
          <CardTitle className="text-lg">施設の状態</CardTitle>
          <CardDescription>
            現在のステータス:{" "}
            <span className="font-semibold">{facilityStatusLabel(facility.isActive)}</span>
            {facility.isActive ? (
              <span className="block mt-1">
                現在、利用者はこの施設・設備を予約できます。無効化するには下のボタンを押してください。
              </span>
            ) : (
              <span className="block mt-1">
                現在、この施設・設備は新規の予約を受け付けていません。
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between pt-0">
          <p className="text-sm text-muted-foreground max-w-md">
            {facility.isActive
              ? "※ 今後の予約（仮予約・開始前の承認済み予約）が残っている場合は無効化できません。"
              : "※ 有効化すると、利用者がすぐに予約を申請できるようになります。"}
          </p>
          <FacilityStatusDialog
            facilityId={facility.id}
            facilityName={facility.name}
            targetStatus={facility.isActive ? "inactive" : "active"}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error)) {
    if (error.status === 403) {
      return (
        <div className="flex flex-col items-center justify-center p-8 min-h-[50vh] text-center">
          <CircleAlert className="size-12 text-destructive mb-4" />
          <h1 className="text-2xl font-bold">事務局スタッフ専用ページです</h1>
          <p className="text-muted-foreground mt-2 max-w-md">
            施設の編集には事務局スタッフの権限が必要です。
          </p>
          <Button asChild className="mt-6">
            <Link to="/">ホームに戻る</Link>
          </Button>
        </div>
      );
    }

    if (error.status === 404) {
      return (
        <div className="flex flex-col items-center justify-center p-8 min-h-[50vh] text-center">
          <CircleAlert className="size-12 text-destructive mb-4" />
          <h1 className="text-2xl font-bold">施設が見つかりません</h1>
          <p className="text-muted-foreground mt-2 max-w-md">
            指定された施設・設備は存在しないか、削除された可能性があります。
          </p>
          <Button asChild className="mt-6">
            <Link to="/staff/facilities">施設一覧に戻る</Link>
          </Button>
        </div>
      );
    }
  }

  return (
    <div className="flex flex-col items-center justify-center p-8 min-h-[50vh] text-center">
      <CircleAlert className="size-12 text-destructive mb-4" />
      <h1 className="text-2xl font-bold">エラーが発生しました</h1>
      <p className="text-muted-foreground mt-2 max-w-md">
        ページの表示に失敗しました。時間をおいてもう一度お試しください。
      </p>
      <Button onClick={() => window.location.reload()} className="mt-6">
        再読み込み
      </Button>
    </div>
  );
}
