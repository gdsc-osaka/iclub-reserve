import type { GroupNameFormState } from "./group-name-form";

/**
 * action が画面へ返す値。
 *
 * どの区画の操作に失敗したかで形が違うので `section` で判別する。
 * 1 つの緩い形にまとめると、団体名の誤りがメンバー欄に出るような取り違えが起きる。
 */
export type GroupActionData =
  | ({ readonly section: "name" } & GroupNameFormState)
  | { readonly section: "members"; readonly error: string };
