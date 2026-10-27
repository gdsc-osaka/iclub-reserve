import { env } from "cloudflare:workers";
import { redirect, type RouterContextProvider } from "react-router";

import {
  SEND_MESSAGE_INTENT,
  type SendMessageActionData,
} from "~/components/reservation/message/reservation-message-form";
import { ReservationField } from "~/domain/reservation";
import { isStaffTransition, parseReservationTransition } from "~/domain/reservation/transition";
import { createReservationAuditLogListQuery } from "~/infra/audit-log/reservation-audit-log-list-query";
import { createDb } from "~/infra/db";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationDetailQuery } from "~/infra/reservation/reservation-detail-query";
import { createReservationMailRecipientsQuery } from "~/infra/reservation/reservation-mail-recipients-query";
import { createReservationMessageListQuery } from "~/infra/reservation/reservation-message-list-query";
import { createReservationMessageRepository } from "~/infra/reservation/reservation-message-repo";
import { createReservationReadRepository } from "~/infra/reservation/reservation-read-repo";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import type { AppArea } from "~/lib/app-area";
import { resolveAppBaseUrl } from "~/lib/app-url.server";
import type { SessionUser } from "~/lib/auth/auth-session.server";
import { parseHistoryPage } from "~/lib/history-page";
import { requireAreaUser, toAreaWhere } from "~/routes/_shared/app-area.server";
import {
  logReservationError,
  reservationActionErrors,
  reservationErrorResponse,
} from "~/routes/_shared/reservation-error.server";
import { changeReservationStatus } from "~/routes/_shared/reservation-transition.server";
import {
  toReservationListPath,
  toReservationListScope,
} from "~/routes/reservations/list/query-params";
import { getReservationUseCase } from "~/usecases/reservation/get-reservation";
import { markReservationReadUseCase } from "~/usecases/reservation/mark-reservation-read";
import { sendReservationMessageUseCase } from "~/usecases/reservation/send-reservation-message";

export interface LoadReservationDetailArgs {
  readonly request: Request;
  readonly context: Readonly<RouterContextProvider>;
  readonly reservationId: string;
}

/**
 * 予約詳細画面（SCR-005）のローダー。利用者の画面と事務局の画面のルートが、どちらの画面かを渡して呼ぶ（ADR-016 決定 10）。
 *
 * 見ている人に見せてよい範囲まで絞った予約と、実行可能な状態変更操作を返す（COND-008）。
 * 他団体の予約では、使用人数・備考・却下/キャンセル理由・作成者に加え、
 * メッセージもユースケースの時点で落ちている。画面側で隠すのではないので、
 * 通信の中身を見ても読めない。
 *
 * 見ている人の立場は、開いている画面で決まる（COND-030 の (1)・ADR-016 決定 18）。
 * 利用者の画面では、事務局であっても団体側の表示と操作になる。
 */
export async function loadReservationDetail(args: LoadReservationDetailArgs, area: AppArea) {
  const where = toAreaWhere(area, "reservations.detail.loader");
  // この画面はログイン必須（root.tsx のミドルウェアが先に確認している）。事務局の画面は事務局でなければ 403
  const { user, actsAsStaff } = await requireAreaUser(args.context, area, where);
  const db = createDb(env.DB);
  const now = new Date();
  const auditLogPage = parseHistoryPage(args.request);

  const result = await getReservationUseCase(
    {
      reservationDetailQuery: createReservationDetailQuery(db),
      membershipRepository: createMembershipRepository(db),
      reservationMessageListQuery: createReservationMessageListQuery(db),
      reservationAuditLogListQuery: createReservationAuditLogListQuery(db),
    },
    {
      reservationId: args.reservationId,
      actorUserId: user.id,
      isStaff: actsAsStaff,
      now,
      auditLogPage,
    },
  );

  if (result.isErr()) {
    // 見られない予約も、無い予約と同じ 404 になる。揃えるのは表の側
    throw reservationErrorResponse({ where, userId: user.id }, result.error);
  }

  /*
   * 予約を開いたら、その予約を既読にする（UC-034 / COND-026 (5)）。
   *
   * GET で書き込むのは、「詳細を開いた」こと自体が「確認した」ことだからである。
   * 開いた後に別の POST を送らせると、送る前に閉じられたときに既読にならない。
   * そのかわり、予約詳細へのリンクに先読み（`<Link prefetch>`）を付けてはいけない。
   * 先読みでもこの loader が走るので、開いていない予約まで既読になってしまう。
   *
   * 書き込みは、応答を返す前に終える。応答の後に回す（waitUntil）と、
   * すぐにダッシュボードへ戻ったときに書き込みが間に合わず、確認した予約が残って見えることがある。
   * 失敗しても画面は開き、ログにだけ残す（既読にならなくても、ダッシュボードに残るだけで済む）。
   */
  if (result.value.view.canViewDetail) {
    await markReservationReadUseCase(
      {
        reservationReadRepository: createReservationReadRepository(db),
        reservationRepository: createReservationRepository(db),
        membershipRepository: createMembershipRepository(db),
      },
      {
        reservationId: args.reservationId,
        actorUserId: user.id,
        isStaff: actsAsStaff,
        now,
      },
    ).match(
      () => undefined,
      (error) => logReservationError({ where: `${where}.mark-read`, userId: user.id }, error),
    );
  }

  return {
    ...result.value,
    listPath: toReservationListPath({}, toReservationListScope(area)),
    area,
  };
}

export interface HandleReservationDetailActionArgs {
  readonly request: Request;
  readonly context: Readonly<RouterContextProvider>;
  readonly reservationId: string;
}

/**
 * 予約へのメッセージの送信（UC-009）。
 *
 * メッセージ欄は useFetcher で送るので、成功しても redirect せずに結果を返す。
 * 一覧は action の後の loader の読み直しで増える。
 * 送れるかどうか（COND-023）はユースケースが決めるので、ここでは確かめない。
 */
async function handleSendMessageAction(
  request: Request,
  reservationId: string,
  user: SessionUser,
  formData: FormData,
  actsAsStaff: boolean,
  where: string,
): Promise<SendMessageActionData> {
  const body = formData.get("body");
  const rawBody = typeof body === "string" ? body : "";
  const db = createDb(env.DB);

  const result = await sendReservationMessageUseCase(
    {
      reservationRepository: createReservationRepository(db),
      membershipRepository: createMembershipRepository(db),
      reservationMessageRepository: createReservationMessageRepository(db),
      reservationMailRecipientsQuery: createReservationMailRecipientsQuery(db),
      mailOutboxNotifier: createQueueMailOutboxNotifier(),
    },
    {
      reservationId,
      actorUserId: user.id,
      actorName: user.name,
      isStaff: actsAsStaff,
      body: rawBody,
      now: new Date(),
      appBaseUrl: resolveAppBaseUrl(request),
    },
  );

  if (result.isErr()) {
    return {
      intent: SEND_MESSAGE_INTENT,
      sent: false,
      ...reservationActionErrors({ where, userId: user.id }, result.error, {
        [ReservationField.MessageBody]: "body",
      }),
    };
  }

  /*
   * 送った人のその予約を既読にする（UC-009 / COND-026 (5)）。
   * 送る前に届いていた相手のメッセージは、送った時点で読んだものとみなす。
   * 失敗してもメッセージは送れているので、ログにだけ残して成功を返す。
   */
  const markReadResult = await markReservationReadUseCase(
    {
      reservationReadRepository: createReservationReadRepository(db),
      reservationRepository: createReservationRepository(db),
      membershipRepository: createMembershipRepository(db),
    },
    {
      reservationId,
      actorUserId: user.id,
      isStaff: actsAsStaff,
      now: new Date(),
    },
  );
  if (markReadResult.isErr()) {
    logReservationError({ where: `${where}.mark-read`, userId: user.id }, markReadResult.error);
  }

  return {
    intent: SEND_MESSAGE_INTENT,
    sent: true,
    body: null,
    formError: null,
  };
}

/**
 * 予約詳細画面からのアクション。ローダーと同じく、2 つのルートが画面を渡して呼ぶ。
 *
 * 状態変更（取り消し・キャンセル・承認・却下・事務局キャンセル）と、メッセージの送信を受ける。
 */
export async function handleReservationDetailAction(
  args: HandleReservationDetailActionArgs,
  area: AppArea,
) {
  const where = toAreaWhere(area, "reservations.detail");
  const { user, actsAsStaff } = await requireAreaUser(args.context, area, `${where}.action`);
  const formData = await args.request.formData();
  const intent = formData.get("intent");
  /*
   * 予約 ID はフォームの値ではなく URL から取る。ダイアログは一覧と共有していて
   * reservationId も送ってくるが、そちらを信じると、この画面から別の予約を操作できてしまう。
   */
  const reservationId = args.reservationId;

  if (intent === SEND_MESSAGE_INTENT) {
    return handleSendMessageAction(
      args.request,
      reservationId,
      user,
      formData,
      actsAsStaff,
      `${where}.send-message`,
    );
  }

  const reason = formData.get("reason");
  const transition = parseReservationTransition(intent);
  if (transition === null) {
    return { formError: "この操作は受け付けられませんでした。画面を読み込み直してください。" };
  }

  /*
   * 受け付ける操作を、開いている画面で絞る（ADR-016 決定 14）。事務局の画面は事務局の操作
   * （承認・却下・事務局キャンセル）だけ、利用者の画面は団体の操作（取り消し・キャンセル）だけを受ける。
   * 画面は立場に合う操作のボタンしか出さないので、出していない操作を受け付けないためである。
   * 操作の可否はユースケースの canTransition が見る。
   */
  if (isStaffTransition(transition) !== actsAsStaff) {
    return { formError: "この操作は受け付けられませんでした。画面を読み込み直してください。" };
  }

  const db = createDb(env.DB);
  const transitionWhere = `${where}.${transition}`;
  const result = await changeReservationStatus(db, args.request, user, {
    reservationId,
    transition,
    reason,
    unlockArrangement: formData.get("unlockArrangement"),
    message: formData.get("message"),
    now: new Date(),
    actsAsStaff,
    where: transitionWhere,
  });

  if (result.isErr()) {
    return reservationActionErrors({ where: transitionWhere, userId: user.id }, result.error);
  }

  return redirect(".");
}
