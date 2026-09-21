import { GroupErrorCode, type GroupError } from "~/domain/group";

/**
 * 画面へ返すアクションエラーの形状（団体名フォーム用）。
 */
export interface GroupActionErrors {
  /** 入力欄のすぐ下に出す文言（未入力・文字数超過など） */
  readonly nameError: string | null;
  /** フォームの上に Alert で出す文言（権限不足・システムエラーなど） */
  readonly formError: string | null;
}

/**
 * 失敗を、利用者に見せてよい文言に変える。操作の種類によらず共通。
 *
 * 【なぜ error.message をそのまま出す場合と出さない場合があるのか】
 * DB の失敗のように、内部の事情（SQL エラーや接続エラーなど）がにじむメッセージは
 * 利用者には意味がなくセキュリティ上も望ましくないため、画面には安全で分かりやすい汎用メッセージを出す。
 * 詳しい原因はサーバー側のログに残す。
 * 一方で、入力値の不正（GroupInvalidInput）や権限不足（GroupForbidden）、
 * 不変条件違反（LastAdminRequired）は、ドメイン層が利用者に向けた修正案内としてメッセージを作成しているため、
 * そのまま画面に表示する。
 */
export const toGroupErrorMessage = (error: GroupError): string => {
  switch (error.code) {
    // ドメインが利用者に向けて書いた文言なのでそのまま通す
    case GroupErrorCode.GroupInvalidInput:
    case GroupErrorCode.GroupForbidden:
    case GroupErrorCode.LastAdminRequired:
      return error.message;

    case GroupErrorCode.MemberNotFound:
      return "対象のメンバーが見つかりませんでした。画面を読み込み直してください。";

    case GroupErrorCode.InvitationNotFound:
      return "対象の招待が見つかりませんでした。画面を読み込み直してください。";

    // ルート側で 404 を throw するため通常ここへは来ないが、網羅のために残す
    case GroupErrorCode.GroupNotFound:
      return "団体が見つかりませんでした。画面を読み込み直してください。";

    // 内部の事情を漏らさないよう、汎用の文言に置き換える。原因はサーバー側のログに残す
    case GroupErrorCode.DatabaseError:
      return "保存できませんでした。時間をおいて、もう一度お試しください。";
  }
};

/** 招待フォーム用のアクションエラー形状 */
export interface GroupInviteFormErrors {
  /** 入力欄のすぐ下に出す文言（未入力・許可外ドメイン・招待済みなど） */
  readonly emailError: string | null;
  /** フォームの上に Alert で出す文言（権限不足・システムエラーなど） */
  readonly formError: string | null;
}

/** 招待フォーム用。入力欄の下に出すか、フォーム全体の Alert に出すかを決める */
export const toInviteFormErrors = (error: GroupError): GroupInviteFormErrors => {
  const message = toGroupErrorMessage(error);

  if (error.code === GroupErrorCode.GroupInvalidInput) {
    return {
      emailError: message,
      formError: null,
    };
  }

  return {
    emailError: null,
    formError: message,
  };
};

/** 団体名フォーム用。入力欄の下に出すか、フォーム全体の Alert に出すかを決める */
export const toActionErrors = (error: GroupError): GroupActionErrors => {
  const message = toGroupErrorMessage(error);

  if (error.code === GroupErrorCode.GroupInvalidInput) {
    return {
      nameError: message,
      formError: null,
    };
  }

  return {
    nameError: null,
    formError: message,
  };
};
