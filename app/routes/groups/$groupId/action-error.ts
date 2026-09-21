import { GroupErrorCode, type GroupError } from "~/domain/group";

/**
 * 画面へ返すアクションエラーの形状。
 */
export interface GroupActionErrors {
  /** 入力欄のすぐ下に出す文言（未入力・文字数超過など） */
  readonly nameError: string | null;
  /** フォームの上に Alert で出す文言（権限不足・システムエラーなど） */
  readonly formError: string | null;
}

/**
 * 操作に失敗したときに、画面へ出す文言と表示位置を決める。
 *
 * 【なぜ error.message をそのまま出す場合と出さない場合があるのか】
 * DB の失敗のように、内部の事情（SQL エラーや接続エラーなど）がにじむメッセージは
 * 利用者には意味がなくセキュリティ上も望ましくないため、画面には安全で分かりやすい汎用メッセージを出す。
 * 詳しい原因はサーバー側のログに残す。
 * 一方で、入力値の不正（GroupInvalidInput）や権限不足（GroupForbidden）は、
 * ドメイン層が利用者に向けた修正案内としてメッセージを作成しているため、そのまま画面に表示する。
 */
export const toActionErrors = (error: GroupError): GroupActionErrors => {
  switch (error.code) {
    /*
     * ドメインが利用者に向けて書いた文言なのでそのまま通す。
     * 入力欄の誤りは入力欄の直下に表示する。
     */
    case GroupErrorCode.GroupInvalidInput:
      return {
        nameError: error.message,
        formError: null,
      };

    /*
     * ドメインが利用者に向けて書いた権限不足の理由をそのまま通す。
     * 入力項目そのものの誤りではないため、フォーム全体の Alert として表示する。
     */
    case GroupErrorCode.GroupForbidden:
      return {
        nameError: null,
        formError: error.message,
      };

    /*
     * ルートのアクション側で COND-011（存在秘匿）に基づき 404 を throw するため
     * 通常この関数には渡ってこないが、GroupErrorCode の網羅性を型安全に保つために定義しておく。
     */
    case GroupErrorCode.GroupNotFound:
      return {
        nameError: null,
        formError: "団体が見つかりませんでした。画面を読み込み直してください。",
      };

    /*
     * 内部エラーは利用者に内部事情を漏らさないよう汎用的な文言に置き換える。
     */
    case GroupErrorCode.DatabaseError:
      return {
        nameError: null,
        formError: "保存できませんでした。時間をおいて、もう一度お試しください。",
      };
  }
};
