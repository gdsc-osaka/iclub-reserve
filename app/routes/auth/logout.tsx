import { redirect } from "react-router";
import type { Route } from "./+types/logout";
import {
  clearSessionCookie,
  deleteSession,
  getSessionCookie,
} from "~/lib/session";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const token = getSessionCookie(request);
  if (token) {
    await deleteSession(env.KV, token);
  }
  throw redirect("/login", {
    headers: { "Set-Cookie": clearSessionCookie() },
  });
}

// GET でアクセスされた場合もログアウト
export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const token = getSessionCookie(request);
  if (token) {
    await deleteSession(env.KV, token);
  }
  throw redirect("/login", {
    headers: { "Set-Cookie": clearSessionCookie() },
  });
}
