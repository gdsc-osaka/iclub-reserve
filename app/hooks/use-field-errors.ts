import { useState } from "react";

/**
 * 送信して戻ってきた、欄ごとのエラー文。
 *
 * エラーの無い欄は `null` を入れるか、キーそのものを持たない。
 */
export type FieldErrorMap<TField extends string> = Readonly<Partial<Record<TField, string | null>>>;

/**
 * その欄に、いま出してよいエラー文を選ぶ。打ち直された欄と、エラーの無い欄は `undefined`。
 *
 * 画面を描かずに確かめられるように、状態を持たない形でフックから分けている。
 */
export const pickFieldError = <TField extends string>(
  errors: FieldErrorMap<TField> | null | undefined,
  editedFields: ReadonlySet<TField>,
  field: TField,
): string | undefined => (editedFields.has(field) ? undefined : (errors?.[field] ?? undefined));

/**
 * 「入力を打ち直したら、前回の送信で出たエラーを消す」をフォームに足す。
 *
 * 【なぜ消すのか】
 * 送信で戻ってきたエラーを出したままにすると、利用者が値を直しても、その欄の
 * `aria-invalid` が true のまま残る。読み上げは直した欄を「不正な入力」と言い続けるので、
 * 画面を見ずに使っている人には、直したことが伝わらない。
 * 赤い文言が残り続けるのも、どこを直せばよいのか分からなくなるという点で同じ。
 *
 * 【使い方】
 * - `fieldError` で、その欄にいま出してよいエラーを取る
 * - `markEdited` を入力の変化（`onChange` や `onValueChange`）から呼ぶ
 * - `resetEdited` を `<Form onSubmit>` から呼ぶ。送信のたびに印を消すのは、
 *   いま送った値に対する新しいエラーは出したいため
 *
 * 伏せるのは画面の表示だけで、送られた値はサーバー側が毎回そのまま確かめる。
 */
export function useFieldErrors<TField extends string>(
  submittedErrors: FieldErrorMap<TField> | null | undefined,
): {
  /** その欄にいま出してよいエラー。打ち直された欄は `undefined` */
  readonly fieldError: (field: TField) => string | undefined;
  /** その欄が打ち直されたことを伝える */
  readonly markEdited: (field: TField) => void;
  /** 打ち直しの印をすべて消す */
  readonly resetEdited: () => void;
} {
  /** 前回の送信のあとに打ち直された欄 */
  const [editedFields, setEditedFields] = useState<ReadonlySet<TField>>(() => new Set());

  return {
    fieldError: (field) => pickFieldError(submittedErrors, editedFields, field),

    // 同じ欄を続けて打つ間は描き直しが要らないので、中身が変わるときだけ入れ替える
    markEdited: (field) =>
      setEditedFields((current) => (current.has(field) ? current : new Set(current).add(field))),

    resetEdited: () => setEditedFields((current) => (current.size === 0 ? current : new Set())),
  };
}
