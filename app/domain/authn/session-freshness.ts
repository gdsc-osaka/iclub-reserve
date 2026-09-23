/**
 * ログインの新しさを判定する有効秒数（COND-019）。
 * Better Auth の既定値（`session.freshAge`）と同じ 24 時間（86,400 秒）とする。
 */
export const SESSION_FRESH_AGE_SECONDS = 60 * 60 * 24;

/**
 * セッションが直近のログイン（24時間以内）であるかどうかを判定する（COND-019）。
 *
 * `now - createdAt < freshAge` のとき true とし、
 * ちょうど 24 時間経過したときは false（Better Auth の判定境界と同一）。
 *
 * @param createdAt セッションの作成日時（ログインした日時）
 * @param now 判定基準の現在時刻（省略時は Date.now()）
 */
export const isFreshSession = (
  createdAt: Date | number,
  now: Date | number = Date.now(),
): boolean => {
  const createdTime = typeof createdAt === "number" ? createdAt : createdAt.getTime();
  const nowTime = typeof now === "number" ? now : now.getTime();

  return nowTime - createdTime < SESSION_FRESH_AGE_SECONDS * 1000;
};
