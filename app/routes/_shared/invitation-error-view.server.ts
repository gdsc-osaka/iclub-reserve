import type { ErrorView } from "./error-response.server";

/**
 * 招待が無いときと、宛先が本人ではないときに出す文言。
 *
 * 2 つを必ず同じにするため、1 か所にだけ書く（COND-011 / COND-015）。
 */
export const INVITATION_NOT_FOUND_TEXT = "招待が見つかりません。";

/**
 * 招待が存在しない（または期限切れ・取り消し済み・承諾済み・辞退済み）ときに出す行。
 * 既定の status は 404。
 */
export const invitationNotFoundView: ErrorView = {
  message: INVITATION_NOT_FOUND_TEXT,
};

/**
 * 招待はあるが宛先が本人ではないときに出す行。
 * 存在秘匿のため、既定の 403 を破って 404 で NotFound と同じ文言を返す（COND-011 / COND-015）。
 */
export const invitationNotVisibleView: ErrorView = {
  status: 404,
  message: INVITATION_NOT_FOUND_TEXT,
};
