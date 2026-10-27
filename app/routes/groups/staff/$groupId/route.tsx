import { AppArea } from "~/lib/app-area";
import {
  GroupDetailErrorBoundary,
  GroupDetailPage,
  toGroupDetailTitle,
} from "~/routes/groups/$groupId/group-detail-page";
import {
  handleGroupDetailAction,
  loadGroupDetail,
} from "~/routes/groups/$groupId/group-detail.server";

import type { Route } from "./+types/route";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: toGroupDetailTitle(loaderData) }];
}

/**
 * 事務局画面の団体管理（SCR-007 / ADR-016 決定 10）。
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  return loadGroupDetail({ request, context, groupId: params.groupId }, AppArea.Staff);
}

export async function action({ request, params, context }: Route.ActionArgs) {
  return handleGroupDetailAction({ request, context, groupId: params.groupId }, AppArea.Staff);
}

export default function StaffGroupManagementRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return <GroupDetailPage loaderData={loaderData} actionData={actionData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <GroupDetailErrorBoundary error={error} area={AppArea.Staff} />;
}
