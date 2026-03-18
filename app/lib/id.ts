/**
 * ランダムな CUID2 風の ID を生成（crypto.randomUUID を使用）
 */
export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
