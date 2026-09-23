import { err, ok, type Result } from "neverthrow";
import { GroupErrorCode, GroupField, type GroupError } from "./index";

/**
 * 団体名の最大文字数。
 *
 * 要件（INFO-003）は団体名を必須の文字列と定めているだけで、長さには触れていない。
 * ここでの 64 文字は「一覧の 1 行・メールの件名に収まる長さ」という画面側の都合で決めた値なので、
 * 要件が長さを定めたときはそちらに合わせること。
 */
export const GROUP_NAME_MAX_LENGTH = 64;

/**
 * 団体名の誤りを表すエラーを作る。
 *
 * @param message ログに残す説明。入力された団体名は埋め込まない
 * @param userMessage 入力欄の下に出す、直し方の分かる文言
 */
const invalidName = (message: string, userMessage: string): GroupError => ({
  code: GroupErrorCode.InvalidInput,
  field: GroupField.Name,
  message,
  userMessage,
});

/**
 * 団体名の入力を検証する純粋関数。
 *
 * 【検証規則】
 * 1. 前後の空白を落とす（trim）。
 * 2. 空白除去後に空文字になった場合はエラー（必須入力）。
 * 3. 改行やタブを含んでいる場合はエラー（見出し・一覧・メールの 1 行として表示されるため、レイアウトが崩れる）。
 * 4. 最大文字数（64文字）を超える場合はエラー（判定には予約の備考と同様に String.prototype.length を使用）。
 * 5. 上記をすべて満たした場合は trim 済みの団体名を返す。
 */
export const validateGroupName = (raw: string | null | undefined): Result<string, GroupError> => {
  if (raw === null || raw === undefined) {
    return err(invalidName("団体名が送られていない。", "団体名を入力してください。"));
  }

  const trimmed = raw.trim();

  if (trimmed === "") {
    return err(invalidName("団体名が空である。", "団体名を入力してください。"));
  }

  // 見出しやメールの 1 行表示を崩さないため、改行やタブ文字を禁止する
  if (/[\r\n\t]/.test(trimmed)) {
    return err(
      invalidName("団体名に改行かタブが含まれている。", "団体名に改行やタブは使えません。"),
    );
  }

  // 文字数の数え方は RESERVATION_NOTE_MAX_LENGTH の判定とそろえ、String.prototype.length を使う
  if (trimmed.length > GROUP_NAME_MAX_LENGTH) {
    return err(
      invalidName(
        `団体名が ${GROUP_NAME_MAX_LENGTH} 文字を超えている。`,
        `団体名は ${GROUP_NAME_MAX_LENGTH} 文字以内で入力してください。`,
      ),
    );
  }

  return ok(trimmed);
};
