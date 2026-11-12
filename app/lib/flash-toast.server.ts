/**
 * action の成功を知らせるトースト（フラッシュ）を、次の画面へ届ける。
 *
 * 【なぜ Cookie か】
 * action から redirect すると actionData は届かないため、短命の Cookie を経由して
 * 次の画面（root の loader）へ知らせの文言を渡す。
 *
 * 【なぜ 60 秒か】
 * リダイレクト直後に読まれる想定だが、読まれずに残った知らせが後から突然出ないよう、
 * 有効期間を 60 秒に制限している。
 *
 * 【なぜ署名しないか】
 * 中身は画面に出す文言だけであり、書き換えられても本人の画面に文字が出るだけで
 * 権限やデータには影響しないため、秘密の値を増やさないよう署名は行わない。
 */

import { findCookieValue } from "~/lib/cookie";
import type { FlashToast, FlashToastInput } from "./flash-toast";

const COOKIE_NAME = "iclub-reserve.flash-toast";

/** 知らせの有効期間（秒）。理由は先頭のコメントを参照 */
const MAX_AGE_SECONDS = 60;

const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 500;

/** Set-Cookie の値を組み立てる。https でないと Secure 付きの Cookie は保存できないため、開発中は付けない */
const toSetCookie = (request: Request, value: string, maxAge: number): string => {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Cookie の中身を確かめて取り出す。形が合わなければ null（書き換えられたものは出さない） */
const parsePayload = (raw: string): FlashToastInput | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const { title, description } = parsed;
  if (typeof title !== "string" || title.length < 1 || title.length > TITLE_MAX_LENGTH) {
    return null;
  }
  if (description === undefined) return { title };
  if (typeof description !== "string" || description.length > DESCRIPTION_MAX_LENGTH) {
    return null;
  }
  return { title, description };
};

/**
 * 知らせを Cookie に書く `Set-Cookie` を持つ Headers を返す。
 *
 * action から `redirect(".", { headers: flashToastHeaders(request, { title: "…" }) })` や
 * `data(値, { headers: flashToastHeaders(...) })` で使う。
 */
export const flashToastHeaders = (request: Request, toast: FlashToastInput): Headers => {
  // description が無ければ JSON.stringify が項目ごと落とす
  const value = encodeURIComponent(
    JSON.stringify({ title: toast.title, description: toast.description }),
  );
  return new Headers({ "Set-Cookie": toSetCookie(request, value, MAX_AGE_SECONDS) });
};

/**
 * リクエストから知らせを取り出す。root の loader から呼ぶ。
 *
 * Cookie があれば、中身が壊れていても消す `Set-Cookie` を返す。
 * 残すと、次に画面を開いたときにも同じ知らせが出てしまう。
 */
export const readFlashToast = (
  request: Request,
): { readonly toast: FlashToast | null; readonly headers: Headers | undefined } => {
  const raw = findCookieValue(request.headers.get("Cookie"), COOKIE_NAME);
  if (raw === null) return { toast: null, headers: undefined };

  const headers = new Headers({ "Set-Cookie": toSetCookie(request, "", 0) });
  const payload = parsePayload(raw);
  if (payload === null) return { toast: null, headers };

  return { toast: { id: crypto.randomUUID(), ...payload }, headers };
};
