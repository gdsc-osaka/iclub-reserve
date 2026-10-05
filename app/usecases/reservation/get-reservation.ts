import { errAsync, okAsync, safeTry, type ResultAsync } from "neverthrow";

import type { Actor, MembershipRepository } from "~/domain/membership";
import {
  ReservationAction,
  ReservationErrorCode,
  type ReservationError,
} from "~/domain/reservation";
import { canEditReservation } from "~/domain/reservation/edit";
import { toMessageSenderLabel } from "~/domain/reservation/message";
import { allowedTransitions, type ReservationTransition } from "~/domain/reservation/transition";
import { canViewReservationDetail } from "~/domain/reservation/visibility";
import type {
  ReservationDetailQuery,
  ReservationDetailRow,
  ReservationDetailView,
} from "~/query/reservation/reservation-detail";
import type {
  ReservationMessageListQuery,
  ReservationMessageRow,
  ReservationMessageView,
} from "~/query/reservation/reservation-message-list";
import {
  ensureCanViewReservation,
  resolveReservationActor,
} from "./_shared/reservation-authorization";

export interface GetReservationDeps {
  readonly reservationDetailQuery: ReservationDetailQuery;
  /** 見ている人が予約の団体に所属しているかを確かめるために使う（COND-008） */
  readonly membershipRepository: MembershipRepository;
  /** 詳細を見られる人（COND-008 の (1)）にだけ、メッセージ（INFO-004）を読むために使う */
  readonly reservationMessageListQuery: ReservationMessageListQuery;
}

export interface GetReservationArgs {
  readonly reservationId: string;
  /** 予約を見ようとしているユーザーの ID */
  readonly actorUserId: string;
  /** そのユーザーが事務局スタッフかどうか（COND-009） */
  readonly isStaff: boolean;
  /** 「開始日時を過ぎたか」の基準。変更できるか（canEdit）の判定に使う */
  readonly now: Date;
}

export interface ReservationDetailResult {
  readonly view: ReservationDetailView;
  /** 見ている人がこの予約に対して実行できる状態変更（allowedTransitions の結果） */
  readonly transitions: readonly ReservationTransition[];
  /** 見ている人がこの予約の内容を変更できるか（canEditReservation の結果） */
  readonly canEdit: boolean;
}

/**
 * DB から取得したメッセージ行を画面用の表示モデルに変換する純粋関数。
 *
 * 送信者の ID は落とし、COND-008 に従って送信者ラベルを解決する。
 */
export const toReservationMessageView = (
  row: ReservationMessageRow,
  actor: Actor,
  actorUserId: string,
): ReservationMessageView => ({
  id: row.id,
  senderLabel: toMessageSenderLabel(row, actor),
  isMine: row.senderId === actorUserId,
  body: row.body,
  sentAt: row.sentAt,
});

/**
 * 予約詳細 1 件を、見ている人に見せてよい形に変換する（COND-008）。
 *
 * 判別可能なユニオンにしてあり、詳細を見られない相手には
 * Summary の項目だけを新しいオブジェクトに詰め替えて渡す。
 * どちらの形にも groupId は含めない。
 *
 * @param messages 詳細を見られる人の形にだけ入れる。見られない人の形には、受け取っても入れない
 */
export const toReservationDetailView = (
  row: ReservationDetailRow,
  actor: Actor,
  messages: readonly ReservationMessageView[],
): ReservationDetailView =>
  canViewReservationDetail(actor)
    ? {
        canViewDetail: true,
        reservation: {
          id: row.id,
          groupName: row.groupName,
          facilityName: row.facilityName,
          startAt: row.startAt,
          endAt: row.endAt,
          status: row.status,
          headCount: row.headCount,
          note: row.note,
          statusReason: row.statusReason,
          createdByName: row.createdByName,
          createdAt: row.createdAt,
          hasApprovedOverlap: row.hasApprovedOverlap,
          hasProvisionalOverlap: row.hasProvisionalOverlap,
        },
        messages,
      }
    : {
        canViewDetail: false,
        reservation: {
          id: row.id,
          groupName: row.groupName,
          facilityName: row.facilityName,
          startAt: row.startAt,
          endAt: row.endAt,
          status: row.status,
        },
      };

/**
 * 予約 1 件を、見ている人に見せてよい範囲で取得するユースケース（SCR-005 / COND-008）。
 *
 * 読み取り専用 Query（{@link ReservationDetailQuery}）で名前や重なり情報まで取得し、
 * 返すのは判別可能なユニオン（{@link ReservationDetailView}）と、実行可能な状態変更操作の一覧。
 * 詳細を見られない相手には使用人数・備考・却下/キャンセル理由・作成者・メッセージを型ごと落として渡す。
 *
 * 【所属を引くのを予約より後にしている理由】
 * どの団体の予約かは、予約を読むまで分からない。団体を引数で受け取って先に
 * 所属を確かめる形にもできるが、そうすると呼び出し側が渡した団体と
 * 予約の団体が一致するかを別に確かめることになり、そこを書き落とすと
 * 自分の団体の ID を添えるだけで他団体の予約が読めてしまう。
 */
export const getReservationUseCase = (
  deps: GetReservationDeps,
  args: GetReservationArgs,
): ResultAsync<ReservationDetailResult, ReservationError> =>
  safeTry(async function* () {
    // 空文字や空白だけの ID は、DB へ問い合わせずに打ち切る
    const id = args.reservationId.trim();
    if (id === "") {
      return errAsync<never, ReservationError>({
        code: ReservationErrorCode.NotFound,
        message: "予約 ID が空である。",
      });
    }

    const row = yield* deps.reservationDetailQuery
      .findByReservationId(id)
      .mapErr((error): ReservationError => ({
        code: ReservationErrorCode.DatabaseError,
        message: "予約詳細を読み取れなかった。",
        cause: error,
      }));

    if (row === null) {
      return errAsync<never, ReservationError>({
        code: ReservationErrorCode.NotFound,
        message: `予約 ${id} が存在しない。`,
      });
    }

    /*
     * 渡す操作は、詳細の閲覧（ViewDetail）ではなく取り消し（Withdraw）にする。
     * 画面は取り消し・キャンセルのボタンを出すかどうかも判定するので、事務局でも
     * その団体での所属が要る。事務局の役割には取り消しが無いため、これで所属が引かれる。
     * ViewDetail を渡すと事務局では所属が省かれ、自分の団体の予約なのに取り消しのボタンが出ない。
     */
    const actor = yield* resolveReservationActor(
      deps,
      row.groupId,
      args,
      ReservationAction.Withdraw,
    );

    yield* ensureCanViewReservation(actor);

    /*
     * 予約詳細を読んだ後に別の往復でメッセージを読む理由：
     * 誰が見ているか（自団体メンバーか事務局か）が分かるまで、メッセージを読んでよいか決められないため。
     * 詳細を見られない人（他団体の人）のときは読まない（読まなければ漏れない）。
     */
    const messages = canViewReservationDetail(actor)
      ? yield* deps.reservationMessageListQuery
          .listByReservationId(id)
          .mapErr((error): ReservationError => ({
            code: ReservationErrorCode.DatabaseError,
            message: "メッセージを読み取れなかった。",
            cause: error,
          }))
          .map((messageRows) =>
            messageRows.map((msgRow) => toReservationMessageView(msgRow, actor, args.actorUserId)),
          )
      : [];

    return okAsync({
      view: toReservationDetailView(row, actor, messages),
      // 詳細を見られない人は所属も事務局の権限も持たないので、ここは自然に空になる
      transitions: allowedTransitions(row, actor),
      // 画面が「変更」の入り口を出すかは、変更のユースケースと同じ判定で決める
      canEdit: canEditReservation(row, actor, args.now).isOk(),
    });
  });
