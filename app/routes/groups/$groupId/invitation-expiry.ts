/**
 * 招待の有効期限までの残り時間を、画面表示用の日本語文字列に整形する。
 *
 * - 1 時間以上: 「あと N 時間で期限切れ」（時間単位で切り捨て）
 * - 1 分以上 1 時間未満: 「あと N 分で期限切れ」（分単位で切り捨て）
 * - 1 分未満（0 以下を含む）: 「まもなく期限切れ」
 *
 * 24 時間を超えても「日」に切り替えないのは、招待の有効期限が 48 時間だから。
 * 日で表すと「あと 1 日」「あと 2 日」の 2 通りにしかならず、
 * あと何時間で切れるのかが読み取れなくなる。
 */
export function formatRemainingTime(expiresAt: Date, now: Date): string {
  const diffMs = expiresAt.getTime() - now.getTime();
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;

  if (diffMs < minuteMs) {
    return "まもなく期限切れ";
  }

  if (diffMs < hourMs) {
    const minutes = Math.floor(diffMs / minuteMs);
    return `あと ${minutes} 分で期限切れ`;
  }

  const hours = Math.floor(diffMs / hourMs);
  return `あと ${hours} 時間で期限切れ`;
}
