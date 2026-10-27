import { SIDEBAR_COOKIE_NAME } from "~/components/ui/sidebar";
import { findCookieValue } from "~/lib/cookie";

/**
 * 外枠（シェル）の見た目のうち、クッキーに残しているものを読む。
 *
 * 画面を描かずに確かめられるように、React に触れるものは置かない。
 */

/**
 * サイドバーを開いた状態にするかどうかを、クッキーから読む。
 *
 * ブラウザ側で判定すると、最初の描画では必ず「開いている」になり、
 * 畳んでいた人の画面でサイドバーが一瞬開いてから閉じる。
 * それを避けるため、サーバー側で最初から正しい状態にしておく。
 *
 * クッキーが無い（＝一度も畳んでいない）ときは開いた状態にする。
 */
export const readSidebarDefaultOpen = (request: Request): boolean => {
  const sidebarState = findCookieValue(request.headers.get("Cookie"), SIDEBAR_COOKIE_NAME);
  return sidebarState !== "false";
};
