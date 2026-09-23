import { errAsync, okAsync, ResultAsync } from "neverthrow";

import {
  ReservationErrorCode,
  type Reservation,
  type ReservationRepository,
} from "~/domain/reservation";
import { type QueryError, QueryErrorCode } from "~/query/error";
import type {
  CreatedReservation,
  ReservationForm,
  ReservationFormData,
  ReservationFormQuery,
  ReservationFormReservation,
  ReservationFormReservationRow,
} from "~/query/reservation/reservation-form";
import type { UserGroupListQuery } from "~/query/user/user-group-list";

/** このユースケースが必要とする依存 */
export interface GetReservationFormDeps {
  readonly reservationFormQuery: ReservationFormQuery;
  /**
   * 「どの予約が自団体のものか」を判定するために、見ている人の所属を引く。
   *
   * 申請元として選べる団体（`reservationFormQuery` が返すもの）では代用できない。
   * 事務局には有効な団体がすべて並ぶので所属の判定に使えず、
   * 一般のユーザーでも、承認待ちの団体で入れた予約が自団体と判定されなくなる。
   */
  readonly userGroupListQuery: UserGroupListQuery;
  /** 申請し終えた直後に、いま作った予約を読み直すために使う */
  readonly reservationRepository: ReservationRepository;
}

/** このユースケースへの入力 */
export interface GetReservationFormArgs {
  /** フォームを開いているユーザーの ID */
  readonly actorUserId: string;
  /** そのユーザーが事務局かどうか（COND-009） */
  readonly isStaff: boolean;
  /** タイムラインに描く期間の開始（この時刻を含む） */
  readonly from: Date;
  /** タイムラインに描く期間の終了（この時刻を含まない） */
  readonly to: Date;
  /** 申請し終えた直後なら、いま作った予約の ID。それ以外は null */
  readonly createdReservationId: string | null;
}

/**
 * 予約 1 件を、見ている人に見せてよい形に絞る（COND-008）。
 *
 * この画面が出すのは「その時間帯が埋まっているか」だけなので、
 * Query の時点で使用人数・備考を読んでいない。ここで落とすのは団体の ID で、
 * 画面は団体名しか出さないのにそのまま渡すと、
 * 使い道の無い識別子だけが他団体のぶんまで手元に残ることになる。
 */
const toVisibleReservation = (
  row: ReservationFormReservationRow,
  myGroupIds: ReadonlySet<string>,
): ReservationFormReservation => ({
  id: row.id,
  facilityId: row.facilityId,
  groupName: row.groupName,
  startAt: row.startAt,
  endAt: row.endAt,
  status: row.status,
  isOwnGroup: myGroupIds.has(row.groupId),
});

/**
 * 申請し終えた直後の予約を読み直す。
 *
 * 申請の結果を画面へ直接返さず、URL のクエリに ID だけを載せて読み直しているのは、
 * 完了画面で再読み込みしても同じ予約がもう一度作られないようにするため
 * （POST の結果をそのまま描くと、再読み込みが再送信になる）。
 *
 * ID は利用者が書き換えられるので、自分が作った予約でなければ渡さない。
 * 渡してしまうと、他人の予約の使用人数・備考を読み取られてしまう（COND-008）。
 *
 * 見つからないときだけ控え無しで済ませる。ID を書き換えられただけなので、
 * フォームをエラー画面に変える理由が無い。
 *
 * 読み取りそのものが失敗したときは、そのまま失敗として返す。
 * ここで握りつぶすと、申請が済んでいるのに空のフォームが出てしまい、
 * 申請できなかったと思った人がもう一度送って、仮予約が二重に作られる
 * （仮予約どうしは重なってよいので、重複の確認では止まらない）。
 */
const findCreated = (
  deps: GetReservationFormDeps,
  args: GetReservationFormArgs,
): ResultAsync<Reservation | null, QueryError> => {
  if (args.createdReservationId === null) return okAsync(null);

  return deps.reservationRepository
    .findById(args.createdReservationId)
    .map((reservation) => (reservation.createdBy === args.actorUserId ? reservation : null))
    .orElse((error): ResultAsync<Reservation | null, QueryError> =>
      error.code === ReservationErrorCode.NotFound
        ? okAsync(null)
        : errAsync({
            code: QueryErrorCode.DatabaseError,
            message: error.message,
            cause: error.cause,
          }),
    );
};

/**
 * 申請し終えた予約に、団体名と施設名を添えて控えの形にする。
 *
 * 名前はフォームの選択肢から引く。控えのためだけに団体・施設を引き直すと、
 * D1 との往復が 2 回増える。
 *
 * 選択肢に無い（申請の直後に団体が無効化された等）ときは控えを出さない。
 * 名前の欠けた控えを出しても、何が申請できたのかが伝わらない。
 */
const toCreatedReservation = (
  reservation: Reservation | null,
  data: ReservationFormData,
): CreatedReservation | null => {
  if (reservation === null) return null;

  const group = data.groups.find((item) => item.id === reservation.groupId);
  const facility = data.facilities.find((item) => item.id === reservation.facilityId);

  if (group === undefined || facility === undefined) return null;

  return {
    id: reservation.id,
    groupName: group.name,
    facilityName: facility.name,
    startAt: reservation.startAt,
    endAt: reservation.endAt,
    headCount: reservation.headCount,
    note: reservation.note,
  };
};

/**
 * 予約申請フォーム（SCR-002 / UC-002）に出すデータを取得するユースケース。
 *
 * 申請元として選べる団体は、事務局かどうかで変わる。
 * 事務局は所属に関わらず任意の団体として申請できるので、所属で絞らない（COND-009）。
 * 一般のユーザーは自分が所属している有効な団体だけ（COND-006）。
 * 「事務局かどうか」を Query に渡さずにここで絞り方へ翻訳しているのは、
 * この分岐が要件（COND-009）であって、読み取りの都合ではないため。
 *
 * 3 つの読み取りは同時に投げる。順に待つと D1 との往復がそのまま待ち時間になる。
 */
export const getReservationFormUseCase = (
  deps: GetReservationFormDeps,
  args: GetReservationFormArgs,
): ResultAsync<ReservationForm, QueryError> =>
  ResultAsync.combine([
    deps.userGroupListQuery.findByUserId(args.actorUserId),
    deps.reservationFormQuery.find({
      memberUserId: args.isStaff ? null : args.actorUserId,
      from: args.from,
      to: args.to,
    }),
    findCreated(deps, args),
  ]).map(([myGroups, data, created]): ReservationForm => {
    const myGroupIds = new Set(myGroups.map((group) => group.id));

    return {
      groups: data.groups,
      facilities: data.facilities,
      reservations: data.reservations.map((row) => toVisibleReservation(row, myGroupIds)),
      created: toCreatedReservation(created, data),
    };
  });
