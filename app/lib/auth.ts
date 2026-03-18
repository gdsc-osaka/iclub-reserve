import { redirect } from "react-router";
import type { CloudflareEnv } from "~/types/cloudflare";
import { getSession, getSessionCookie } from "./session";

export async function requireAuth(request: Request, env: CloudflareEnv) {
  const token = getSessionCookie(request);
  if (!token) throw redirect("/login");

  const session = await getSession(env.KV, token);
  if (!session) throw redirect("/login");

  return session;
}

export async function requireStaff(request: Request, env: CloudflareEnv) {
  const session = await requireAuth(request, env);
  if (!session.isStaff) throw redirect("/");
  return session;
}

export async function getOptionalAuth(request: Request, env: CloudflareEnv) {
  const token = getSessionCookie(request);
  if (!token) return null;
  return getSession(env.KV, token);
}

export function isOsakaUDomain(email: string): boolean {
  return /^[^@]+@([a-z0-9-]+\.)*osaka-u\.ac\.jp$/i.test(email);
}
