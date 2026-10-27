import { redirect } from "react-router";

import { appAreaLinks } from "~/components/layout/app-area";
import { resolveShellArea } from "~/lib/app-area";
import { readLastArea } from "~/components/layout/last-area-cookie";
import { requireRequestUser } from "~/lib/auth/auth-session.server";

import type { Route } from "./+types/route";

/**
 * ログイン後の行き先を決定して転送するルート（ADR-016 決定 4）。
 *
 * 画面を持たず、loader だけで前回開いていた画面の領域（事務局は Cookie または /staff、利用者は /）へ転送する。
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireRequestUser(context);

  const area = resolveShellArea({
    isStaff: user.is_staff,
    pathArea: null,
    lastArea: user.is_staff ? readLastArea(request) : null,
  });

  return redirect(appAreaLinks[area].to);
}
