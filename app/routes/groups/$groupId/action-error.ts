import { GroupErrorCode, type GroupError } from "~/domain/group";
import { toGroupErrorMessage } from "~/lib/group-error-message";

/**
 * 画面へ返すアクションエラーの形状（団体名フォーム用）。
 */
export interface GroupActionErrors {
  /** 入力欄のすぐ下に出す文言（未入力・文字数超過など） */
  readonly nameError: string | null;
  /** フォームの上に Alert で出す文言（権限不足・システムエラーなど） */
  readonly formError: string | null;
}

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
