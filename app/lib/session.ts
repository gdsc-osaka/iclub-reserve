import type { KVNamespace } from "@cloudflare/workers-types";
import type { User } from "~/db/schema";

const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days in seconds
const SESSION_COOKIE_NAME = "session";

export interface SessionData {
  userId: string;
  email: string;
  name: string;
  isStaff: boolean;
}

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSession(
  kv: KVNamespace,
  user: Pick<User, "id" | "email" | "name" | "isStaff">,
): Promise<string> {
  const token = generateId();
  const data: SessionData = {
    userId: user.id,
    email: user.email,
    name: user.name,
    isStaff: user.isStaff,
  };
  await kv.put(`session:${token}`, JSON.stringify(data), {
    expirationTtl: SESSION_TTL,
  });
  return token;
}

export async function getSession(
  kv: KVNamespace,
  token: string,
): Promise<SessionData | null> {
  const raw = await kv.get(`session:${token}`);
  if (!raw) return null;
  return JSON.parse(raw) as SessionData;
}

export async function deleteSession(
  kv: KVNamespace,
  token: string,
): Promise<void> {
  await kv.delete(`session:${token}`);
}

export function getSessionCookie(request: Request): string | null {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, v.join("=")];
    }),
  );
  return cookies[SESSION_COOKIE_NAME] ?? null;
}

export function setSessionCookie(token: string, secure: boolean): string {
  const flags = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL}`,
    "Path=/",
    ...(secure ? ["Secure"] : []),
  ];
  return flags.join("; ");
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`;
}
