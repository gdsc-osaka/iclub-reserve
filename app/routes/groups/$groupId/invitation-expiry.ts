/**
 * 招待の有効期限までの残り時間を、画面表示用の日本語文字列に整形する。
 *
 * 利用者が残り期間を直感的に把握できるよう、単位を切り替えて表示する。
 *
 * - 24 時間以上: 「あと N 日で期限切れ」（日単位で切り捨て）
 * - 1 時間以上 24 時間未満: 「あと N 時間で期限切れ」（時間単位で切り捨て）
 * - 1 分以上 1 時間未満: 「あと N 分で期限切れ」（分単位で切り捨て）
 * - 1 分未満（0 以下を含む）: 「まもなく期限切れ」
 */
export function formatRemainingTime(expiresAt: Date, now: Date): string {
  const diffMs = expiresAt.getTime() - now.getTime();
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) {
    return "まもなく期限切れ";
  }

  if (diffMs < hourMs) {
    const minutes = Math.floor(diffMs / minuteMs);
    return `あと ${minutes} 分で期限切れ`;
  }

  if (diffMs < dayMs) {
    const hours = Math.floor(diffMs / hourMs);
    return `あと ${hours} 時間で期限切れ`;
  }

  const days = Math.floor(diffMs / dayMs);
  return `あと ${days} 日で期限切れ`;
}
