/**
 * 事務局のダッシュボードを定期的に読み直す間隔（5 分）。
 *
 * 5 分にした理由: D1 の無料枠（1 日 500 万行）に収めるため。
 * /staff を 1 回読むと予約 4,000 件で約 4 千行読み、60 秒ごとだと 1 タブで 1 日約 300 万行になって、2 人が開けば超える。詳しくは ADR-019。
 */
export const STAFF_DASHBOARD_REVALIDATE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 画面に戻ってきたとき、前回の読み込みからこれだけたっていれば読み直す（30 秒）。
 *
 * タブを行き来するたびに読み直さないため。
 */
export const RETURN_REVALIDATE_AFTER_MS = 30 * 1000;

/**
 * 読み直すかを確かめる間隔（15 秒）。
 *
 * ダイアログを閉じた後なども、間隔を過ぎていればこの時間のうちに読み直す。
 */
export const AUTO_REVALIDATE_CHECK_MS = 15 * 1000;

export interface AutoRevalidateConditions {
  /** 画面（タブ）が表示されているか */
  readonly isVisible: boolean;
  /** ブラウザがオンラインか */
  readonly isOnline: boolean;
  /** 画面の移動中・送信中・読み直しの途中か */
  readonly isBusy: boolean;
  /** ダイアログが開いているか */
  readonly isDialogOpen: boolean;
  /** 前回の読み込みからの経過時間（ミリ秒） */
  readonly elapsedMs: number;
  /** 読み直しの基準となる経過時間のしきい値（ミリ秒） */
  readonly thresholdMs: number;
}

/**
 * ダッシュボードを自動で読み直すべきかを判定する。
 */
export const shouldAutoRevalidate = ({
  isVisible,
  isOnline,
  isBusy,
  isDialogOpen,
  elapsedMs,
  thresholdMs,
}: AutoRevalidateConditions): boolean => {
  // 裏にあるタブ: 見ていない画面のために D1 を読まない
  if (!isVisible) {
    return false;
  }
  // オフライン: 読み直しが失敗してエラー画面に替わるのを避ける
  if (!isOnline) {
    return false;
  }
  // 移動中・送信中・読み直し中: 終わったあとに React Router が自分で読み直すので、重ねない
  if (isBusy) {
    return false;
  }
  // ダイアログ: ほかの事務局が先に片付けた予約は、読み直すと行ごと消え、入力中の却下の理由も消えるため
  if (isDialogOpen) {
    return false;
  }
  return elapsedMs >= thresholdMs;
};
