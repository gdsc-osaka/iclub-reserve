import { AppArea } from "~/lib/app-area";

import type { Route } from "./+types/route";
import { GroupDetailErrorBoundary, GroupDetailPage, toGroupDetailTitle } from "./group-detail-page";
import { handleGroupDetailAction, loadGroupDetail } from "./group-detail.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: toGroupDetailTitle(loaderData) }];
}

/**
 * 利用者画面の団体管理（SCR-007 / ADR-016 決定 10）。
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  return loadGroupDetail({ request, context, groupId: params.groupId }, AppArea.User);
}

export async function action({ request, params, context }: Route.ActionArgs) {
  return handleGroupDetailAction({ request, context, groupId: params.groupId }, AppArea.User);
}

export default function GroupManagementRoute({ loaderData, actionData }: Route.ComponentProps) {
  return <GroupDetailPage loaderData={loaderData} actionData={actionData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <GroupDetailErrorBoundary error={error} area={AppArea.User} />;
}
