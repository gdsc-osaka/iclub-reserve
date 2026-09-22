import { GroupErrorCode, type GroupError } from "~/domain/group";

/**
 * 操作の対象になるメンバーが指定されていないときに返すエラー。
 *
 * 団体の存在を秘匿する groupNotFound() とは違い、こちらは素直に理由を伝える。
 * 対象が空という事実は、団体があるかどうかを何も明かさないため。
 */
export const memberNotSpecified = (): GroupError => ({
  code: GroupErrorCode.GroupInvalidInput,
  message: "対象のメンバーが指定されていません。",
});

/**
 * 操作の対象になるメンバーが、その団体に居なかったときに返すエラー。
 *
 * 確認の時点で居なかった場合と、確認から更新までの間に別の操作で外された場合
 * （更新件数が 0 件）の両方で使う。利用者から見ればどちらも同じ結果なので、
 * 書き分けても伝わる情報が増えない。
 */
export const memberNotFound = (): GroupError => ({
  code: GroupErrorCode.MemberNotFound,
  message: "対象のメンバーはこの団体に所属していません。",
});
