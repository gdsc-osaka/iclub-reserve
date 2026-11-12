/**
 * ブラウザごとの通信エラーメッセージの一覧。
 */
const NETWORK_ERROR_MESSAGES = [
  // Chrome・Edge
  "Failed to fetch",
  // Chrome・Edge（本文の途中で切れたとき）
  "network error",
  // Firefox
  "NetworkError when attempting to fetch resource",
  // Firefox（本文の途中で切れたとき）
  "Error in input stream",
  // Safari
  "Load failed",
  // 古い Safari
  "The network connection was lost",
] as const;

/**
 * React Router が、読み直しの返事（single fetch）の本文を読めなかったときに投げるエラーの文言。
 * 元の例外は cause に入る（react-router の lib/dom/ssr/single-fetch）。
 */
const SINGLE_FETCH_DECODE_ERROR_MESSAGE = "Unable to decode turbo-stream response";

/**
 * 読み直し（自動の読み直しを含む）や画面の移動が、サーバーに届かずに失敗したかを見分ける。
 * サーバーが返したエラー（404・500 など）は含めない。
 */
export const isNetworkError = (error: unknown): boolean => {
  // 返事の本文を受け取っている途中で切れたときは、本文を読めなかったエラーに包まれて届く。
  // 本文が壊れていただけのとき（cause が通信のエラーでないとき）は含めない
  if (error instanceof Error && error.message === SINGLE_FETCH_DECODE_ERROR_MESSAGE) {
    return isNetworkError(error.cause);
  }
  if (!(error instanceof TypeError)) {
    return false;
  }
  return NETWORK_ERROR_MESSAGES.some((msg) => error.message.includes(msg));
};
