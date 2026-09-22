import { GroupErrorCode, type GroupError } from "~/domain/group";

/**
 * 招待を扱えないときに返すエラー。
 *
 * 「存在しない」「期限切れ」「取り消し済み」「すでに承諾済み」「宛先が違う」を
 * すべて同じ値にまとめている。書き分けると、招待 ID を総当たりして
 * 「この招待は実在する」と分かってしまい、所属していない団体の存在が漏れる（COND-011 存在の秘匿）。
 *
 * 招待を扱うユースケースは、この 1 本を通すこと。
 * 各ユースケースに書き写すと、秘匿の扱いが少しずつ食い違っていく。
 */
export const invitationNotFound = (): GroupError => ({
  code: GroupErrorCode.InvitationNotFound,
  message: "招待が見つかりません。",
});
