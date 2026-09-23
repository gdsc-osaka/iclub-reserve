import { env } from "cloudflare:workers";
import { CircleAlert } from "lucide-react";
import { Form, isRouteErrorResponse, Link, redirect, useNavigation } from "react-router";

import { FacilityForm } from "~/components/facility/facility-form";
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
import { createFacilityUseCase } from "~/usecases/facility/create-facility";
import { openFacilityCreateFormUseCase } from "~/usecases/facility/open-facility-create-form";

import type { Route } from "./+types/route";

export function meta() {
  return [{ title: "施設の登録 | iclub-reserve" }];
}

/** 施設写真を含む送信の許容上限バイト数（6 MiB） */
const MAX_CONTENT_LENGTH_BYTES = 6 * 1024 * 1024;

/**
 * 施設登録画面のローダー。
 *
 * 事務局スタッフ限定（COND-009）。
 */
export async function loader({ context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);

  const result = await openFacilityCreateFormUseCase({
    actorUserId: user.id,
    isStaff: user.is_staff,
  });

  if (result.isErr()) {
    throw facilityErrorResponse(
      { where: "staff.facilities.new.loader", userId: user.id },
      result.error,
    );
  }

  return {};
}

/**
 * 施設登録アクション（UC-015）。
 */
export async function action({ request, context }: Route.ActionArgs) {
  const user = requireRequestUser(context);

  // 1. Content-Length による巨大リクエストの事前遮断
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_CONTENT_LENGTH_BYTES) {
    return {
      initialValues: {
        name: "",
        description: null,
        googleCalendarId: null,
        isActive: true,
      },
      [FacilityField.Name]: null,
      [FacilityField.Description]: null,
      [FacilityField.Photo]: "送信サイズが大きすぎます（上限 5 MiB）。",
      [FacilityField.GoogleCalendarId]: null,
      formError: "送信されたデータが上限を超えています。",
    };
  }

  // 2. フォームデータの取得
  const formData = await request.formData();
  const rawName = formData.get(FacilityField.Name);
  const rawDescription = formData.get(FacilityField.Description);
  const rawGoogleCalendarId = formData.get(FacilityField.GoogleCalendarId);
  const rawPhoto = formData.get(FacilityField.Photo);
  const photo = rawPhoto instanceof File ? rawPhoto : null;
  const isActive = formData.get("is_active") === "on";

  const name = typeof rawName === "string" ? rawName : "";
  const description = typeof rawDescription === "string" ? rawDescription : null;
  const googleCalendarId = typeof rawGoogleCalendarId === "string" ? rawGoogleCalendarId : null;

  // 3. ユースケース実行
  const db = createDb(env.DB);
  const photoStorage = createR2FacilityPhotoStorage(env.MEDIA);
  const result = await createFacilityUseCase(
    {
      facilityRepository: createFacilityRepository(db),
      facilityPhotoStorage: photoStorage,
    },
    {
      actorUserId: user.id,
      isStaff: user.is_staff,
      name,
      description,
      googleCalendarId,
      photo,
      isActive,
      now: new Date(),
    },
  );

  if (result.isErr()) {
    return {
      initialValues: {
        name,
        description,
        googleCalendarId,
        isActive,
      },
      ...facilityActionErrors(
        { where: "staff.facilities.new.action", userId: user.id },
        result.error,
        {
          [FacilityField.Name]: FacilityField.Name,
          [FacilityField.Description]: FacilityField.Description,
          [FacilityField.Photo]: FacilityField.Photo,
          [FacilityField.GoogleCalendarId]: FacilityField.GoogleCalendarId,
        },
      ),
    };
  }

  return redirect("/staff/facilities");
}

export default function NewFacilityPage({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const errors = actionData
    ? {
        [FacilityField.Name]: actionData.facility_name,
        [FacilityField.Description]: actionData.facility_description,
        [FacilityField.Photo]: actionData.facility_photo,
        [FacilityField.GoogleCalendarId]: actionData.google_calendar_id,
        formError: actionData.formError,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-6 p-4 md:p-8 max-w-2xl mx-auto w-full">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">施設・設備の新規登録</CardTitle>
          <CardDescription>
            新しい施設や設備をシステムに登録します。登録した施設は予約対象として利用者に公開されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" encType="multipart/form-data">
            <FacilityForm
              mode="create"
              initialValues={actionData?.initialValues}
              errors={errors}
              isSubmitting={isSubmitting}
            />
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 403) {
    return (
      <div className="flex flex-col items-center justify-center p-8 min-h-[50vh] text-center">
        <CircleAlert className="size-12 text-destructive mb-4" />
        <h1 className="text-2xl font-bold">事務局スタッフ専用ページです</h1>
        <p className="text-muted-foreground mt-2 max-w-md">
          施設を登録するには事務局スタッフの権限が必要です。
        </p>
        <Button asChild className="mt-6">
          <Link to="/">ホームに戻る</Link>
        </Button>
      </div>
    );
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
