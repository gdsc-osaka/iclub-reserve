/**
 * ブラウザごとの通信エラーメッセージの一覧。
 */
const NETWORK_ERROR_MESSAGES = [
  // Chrome・Edge
  "Failed to fetch",
  // Firefox
  "NetworkError when attempting to fetch resource",
  // Safari
  "Load failed",
  // 古い Safari
  "The network connection was lost",
] as const;

/**
 * 読み直し（自動の読み直しを含む）や画面の移動が、サーバーに届かずに失敗したかを見分ける。
 * サーバーが返したエラー（404・500 など）は含めない。
 */
export const isNetworkError = (error: unknown): boolean => {
  if (!(error instanceof TypeError)) {
    return false;
  }
  return NETWORK_ERROR_MESSAGES.some((msg) => error.message.includes(msg));
};
