import { type AppArea, toSharedScreenPath } from "~/lib/app-area";

/**
 * 予約まわりの画面を行き来する URL を組み立てる。
 *
 * 画面の部品（app/components/）や複数のルートから使うため、
 * ルートの枠組みから独立した道具として app/lib/ に集めている。
 * 組み立て方を 1 か所に集めておくことで、パラメータの付け忘れやパスの食い違いを防ぐ。
 */

/**
 * 予約詳細（SCR-005）の URL を組み立てる。
 */
export const toReservationDetailPath = (area: AppArea, reservationId: string): string =>
  toSharedScreenPath(area, `/reservations/${encodeURIComponent(reservationId)}`);

/**
 * 予約の変更画面（UC-005 / UC-017）の URL を組み立てる。
 *
 * 施設・日付のクエリは付けない。付けなければ、変更画面は予約の施設・開始日で開く。
 */
export const toReservationEditPath = (area: AppArea, reservationId: string): string =>
  toSharedScreenPath(area, `/reservations/${encodeURIComponent(reservationId)}/edit`);

/**
 * 予約の申請（事務局は作成）の入口の行き先（SCR-002）。
 */
export const toNewReservationPath = (area: AppArea): string =>
  toSharedScreenPath(area, "/reservations/new");

/**
 * 施設だけを選んだ状態で予約申請（カレンダーへの転送）を開く URL。日付は画面の既定（今日）になる。
 *
 * 却下された予約から「別の日時で申請」するときのように、日付を決めずに入るときに使う。
 */
export const toFormPathForFacility = (area: AppArea, facilityId: string): string =>
  `${toNewReservationPath(area)}?facility=${encodeURIComponent(facilityId)}`;

/**
 * 重なりの解決（COND-031）の読み取り URL を組み立てる。
 *
 * 事務局の画面でのみ使うため、area は受け取らない。
 */
export const toOverlapResolutionPath = (reservationId: string): string =>
  `/staff/reservations/${encodeURIComponent(reservationId)}/overlaps`;
