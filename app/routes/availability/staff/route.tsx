import { AppArea } from "~/lib/app-area";
import {
  AvailabilityErrorBoundary,
  AvailabilityPage,
  shouldRevalidate,
} from "~/routes/availability/availability-page";
import {
  handleAvailabilityAction,
  loadAvailability,
} from "~/routes/availability/availability.server";

import type { Route } from "./+types/route";

export { shouldRevalidate };

export function meta() {
  return [{ title: "空き状況 | i-Club 予約システム" }];
}

/**
 * 事務局画面の空き状況カレンダー（SCR-001 / ADR-016 決定 10）。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  return loadAvailability({ request, context }, AppArea.Staff);
}

export async function action({ request, context }: Route.ActionArgs) {
  return handleAvailabilityAction({ request, context }, AppArea.Staff);
}

export default function StaffAvailabilityRoute({ loaderData, actionData }: Route.ComponentProps) {
  return <AvailabilityPage loaderData={loaderData} actionData={actionData} />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <AvailabilityErrorBoundary error={error} area={AppArea.Staff} />;
}
