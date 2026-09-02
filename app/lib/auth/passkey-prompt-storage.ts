import {
  parsePasskeyPromptState,
  recordDismissal,
  shouldSuggestPasskey,
} from "~/domain/auth/passkey-prompt";

/**
 * 「あとで」の記録を端末に保存するためのキー。
 *
 * 他のアプリと同じ localStorage を共有することがあるため、
 * アプリ名で始まる名前にして衝突を避けている。
 */
const STORAGE_KEY = "iclub-reserve.passkey-prompt";

/**
 * 「あとで」の記録の保存場所。
 *
 * サーバーではなく端末（localStorage）に置いている。
 * パスキーは端末ごとに作るものなので、「ノート PC で断った」ことを
 * スマートフォンにまで引き継ぐと、勧める機会をいたずらに失ってしまう。
 *
 * 記録が読めなくても書けなくてもログインには影響しない
 * （最悪でも、勧める画面が余分に出る／出ないだけ）ため、
 * 失敗はすべて握り潰して「記録なし」として扱う。
 * Safari のプライベートモードなど、localStorage を触るだけで
 * 例外が出る環境があるため、この扱いは必須。
 */
const readState = () => {
  try {
    return parsePasskeyPromptState(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
};

/**
 * この端末で、パスキーの登録を勧める頃合いかどうか。
 *
 * ブラウザでしか動かないので、ローダーなどサーバー側から呼ばないこと。
 */
export const shouldSuggestPasskeyOnThisDevice = (): boolean =>
  shouldSuggestPasskey(readState(), Date.now());

/** 「あとで」を選ばれたことを記録し、しばらく勧めないようにする。 */
export const rememberPasskeyPromptDismissed = (): void => {
  const next = recordDismissal(readState(), Date.now());

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても、次に勧めるのが早まるだけなので何もしない。
  }
};

/**
 * 「あとで」の記録を消す。
 *
 * パスキーを登録できた人には、もうこの記録は要らない。
 * 将来パスキーをすべて削除した人にまた勧められるよう、
 * 残しておかずにここで消しておく。
 */
export const forgetPasskeyPromptDismissals = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 消せなくても実害はないので何もしない。
  }
};
