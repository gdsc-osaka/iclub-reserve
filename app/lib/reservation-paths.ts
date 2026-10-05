/**
 * 予約まわりの画面を行き来する URL を組み立てる。
 *
 * 画面の部品（app/components/）や複数のルートから使うため、
 * ルートの枠組みから独立した道具として app/lib/ に集めている。
 * 組み立て方を 1 か所に集めておくことで、パラメータの付け忘れやパスの食い違いを防ぐ。
 */

/**
 * 予約詳細（SCR-005）の URL を組み立てる。
 *
 * `edited` は変更画面から戻るときにだけ付け、詳細画面に「変更しました」の案内を出させる。
 */
export const toReservationDetailPath = (
  reservationId: string,
  options?: { readonly edited?: "changed" | "unchanged" },
): string => {
  const base = `/reservations/${encodeURIComponent(reservationId)}`;
  if (options?.edited !== undefined) {
    return `${base}?edited=${options.edited}`;
  }
  return base;
};

/**
 * 予約の変更画面（UC-005 / UC-017）の URL を組み立てる。
 *
 * 施設・日付のクエリは付けない。付けなければ、変更画面は予約の施設・開始日で開く。
 */
export const toReservationEditPath = (reservationId: string): string =>
  `/reservations/${encodeURIComponent(reservationId)}/edit`;
