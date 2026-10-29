import { env } from "cloudflare:workers";
import { redirect, type RouterContextProvider } from "react-router";

import { isStaffTransition, parseReservationTransition } from "~/domain/reservation/transition";
import { createDb } from "~/infra/db";
import { createFacilityAvailabilityCalendarQuery } from "~/infra/facility/facility-availability-calendar-query";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createD1HolidayQuery } from "~/infra/holiday/d1-holiday-query";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { createReservationRepository } from "~/infra/reservation/reservation-repo";
import type { AppArea } from "~/lib/app-area";
import { parseTokyoDateKey, toTokyoDateKey } from "~/lib/date";
import { createApplicantGroupQuery } from "~/query/reservation/applicant-groups";
import { createUserGroupListQuery } from "~/query/user/user-group-list";
import { requireAreaUser, toAreaWhere } from "~/routes/_shared/app-area.server";
import type { ActionErrors } from "~/routes/_shared/error-response.server";
import { queryErrorResponse } from "~/routes/_shared/query-error.server";
import {
  reservationActionErrors,
  reservationErrorResponse,
} from "~/routes/_shared/reservation-error.server";
import { changeReservationStatus } from "~/routes/_shared/reservation-transition.server";
import { getAvailabilityCalendarUseCase } from "~/usecases/facility/get-availability-calendar";
import { getReservationEditFormUseCase } from "~/usecases/reservation/get-reservation-edit-form";

import {
  CREATE_RESERVATION_INTENT,
  type CreateReservationActionError,
} from "./availability-draft-form";
import { EDIT_RESERVATION_INTENT, type EditReservationActionError } from "./availability-edit-form";
import {
  toCalendarPeriods,
  toCalendarWindowStart,
  toDraftDayOutsideWindow,
} from "./calendar-window";
import { createReservationAction } from "./create-reservation.server";
import { editReservationAction } from "./edit-reservation.server";
import { parseCalendarSelection } from "./paths";

export interface LoadAvailabilityArgs {
  readonly request: Request;
  readonly context: Readonly<RouterContextProvider>;
}

/**
 * 空き状況カレンダー（SCR-001）に出すデータを取る。利用者の画面と事務局の画面のルートが、
 * どちらの画面かを渡して呼ぶ（ADR-016 決定 10）。
 *
 * 施設と基準の日は URL のクエリで受け取る。画面の状態を URL に置くことで、
 * 「この施設のこの日」をそのまま人に送れるようにしている。
 * クエリは利用者が自由に書き換えられるので、値はすべて確かめてから使う。
 *
 * 読むのは、基準の日の週の前の週から 4 週間（ADR-014 決定 4）。
 * 欄で開いている仮の枠の日がその外にあれば、その日も読む（ADR-014 決定 19）。
 * カレンダーを遠くの日へ送っても、欄の日時の判定（重なり・押せない時刻）に使う予約が手元に残る。
 *
 * URL の選択が変更（edit）のときは、変更する予約も同時に読む（ADR-014 決定 16）。
 *
 * 申請元に出す団体と、欄で直接作成するかは、開いている画面の立場で決まる（ADR-016 決定 13）。
 */
export async function loadAvailability(args: LoadAvailabilityArgs, area: AppArea) {
  const where = toAreaWhere(area, "availability.loader");
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)。事務局の画面は事務局でなければ 403
  const { user, actsAsStaff } = await requireAreaUser(args.context, area, where);

  const url = new URL(args.request.url);

  /*
   * 「いま」はローダーで 1 回だけ読んで画面へ渡す。
   * 描画のたびに new Date() を呼ぶと、サーバーで描いた内容とブラウザで
   * 描き直した内容が食い違い、画面がちらつく。
   */
  const now = new Date();

  // 日付の指定が無い・壊れているときは今日を基準の日にする。エラーにはしない
  const anchorDate = parseTokyoDateKey(url.searchParams.get("date")) ?? now;
  const windowStart = toCalendarWindowStart(anchorDate);

  const db = createDb(env.DB);

  const parsedSelection = parseCalendarSelection(url.searchParams);
  const draftDayOutsideWindow = toDraftDayOutsideWindow(windowStart, parsedSelection);

  // 空き状況の読み取りと、変更する予約の読み取りを同時に呼ぶ（順に待つと D1 との往復がそのまま待ち時間になるため）
  const calendarPromise = getAvailabilityCalendarUseCase(
    {
      facilityAvailabilityCalendarQuery: createFacilityAvailabilityCalendarQuery(db),
      userGroupListQuery: createUserGroupListQuery(db),
      holidayQuery: createD1HolidayQuery(db),
      applicantGroupQuery: createApplicantGroupQuery(db),
    },
    {
      actorUserId: user.id,
      isStaff: actsAsStaff,
      facilityId: url.searchParams.get("facility"),
      periods: toCalendarPeriods(windowStart, draftDayOutsideWindow),
      now,
    },
  );

  const editPromise =
    parsedSelection?.kind === "edit"
      ? getReservationEditFormUseCase(
          {
            reservationRepository: createReservationRepository(db),
            membershipRepository: createMembershipRepository(db),
            groupRepository: createGroupRepository(db),
          },
          {
            reservationId: parsedSelection.reservationId,
            actorUserId: user.id,
            isStaff: actsAsStaff,
            now,
          },
        )
      : null;

  const [calendarResult, editResult] = await Promise.all([calendarPromise, editPromise]);

  if (calendarResult.isErr()) {
    // 無い施設は 404、DB の失敗は 500 になる。どちらもログに残る
    throw queryErrorResponse({ where, userId: user.id }, calendarResult.error);
  }

  if (editResult !== null && editResult.isErr()) {
    throw reservationErrorResponse(
      { where: toAreaWhere(area, "availability.edit.loader"), userId: user.id },
      editResult.error,
    );
  }

  const edit = editResult === null ? null : editResult.value;

  return {
    calendar: calendarResult.value,
    windowStart,
    draftDayOutsideWindow,
    anchorKey: toTokyoDateKey(anchorDate),
    now,
    edit,
    area,
  };
}

export interface HandleAvailabilityActionArgs {
  readonly request: Request;
  readonly context: Readonly<RouterContextProvider>;
}

/**
 * 空き状況カレンダーからの操作。欄からの予約の作成（申請・直接作成）および変更と、
 * 事務局の状態変更（承認・却下・事務局キャンセル）を受け付ける。ローダーと同じく、2 つのルートが画面を渡して呼ぶ。
 *
 * 戻り値の型を書いているのは、画面の側で失敗を `intent` で見分けられるようにするため。
 */
export async function handleAvailabilityAction(
  args: HandleAvailabilityActionArgs,
  area: AppArea,
): Promise<
  CreateReservationActionError | EditReservationActionError | ActionErrors<never> | Response
> {
  const { user, actsAsStaff } = await requireAreaUser(
    args.context,
    area,
    toAreaWhere(area, "availability.action"),
  );

  const formData = await args.request.formData();
  const intent = formData.get("intent");

  if (intent === CREATE_RESERVATION_INTENT) {
    return createReservationAction({
      request: args.request,
      formData,
      user,
      actsAsStaff,
      area,
    });
  }

  if (intent === EDIT_RESERVATION_INTENT) {
    return editReservationAction({
      request: args.request,
      formData,
      user,
      actsAsStaff,
      area,
    });
  }

  const reservationId = formData.get("reservationId");
  const reason = formData.get("reason");

  if (typeof reservationId !== "string" || !reservationId) {
    return { formError: "予約が指定されていません。" };
  }

  /*
   * 事務局の操作のみを、事務局の画面でだけ受け付ける（ADR-016 決定 14）。利用者の画面は、
   * 事務局であっても団体側の欄しか出さないためである。可否はユースケースに任せる。
   */
  const transition = parseReservationTransition(intent);

  if (!actsAsStaff || transition === null || !isStaffTransition(transition)) {
    return { formError: "この操作は受け付けられませんでした。画面を読み込み直してください。" };
  }

  const db = createDb(env.DB);
  const where = toAreaWhere(area, `availability.${transition}`);
  const result = await changeReservationStatus(db, args.request, user, {
    reservationId,
    transition,
    reason,
    rejectReservationIds: formData.getAll("rejectReservationId"),
    unlockArrangement: formData.get("unlockArrangement"),
    message: formData.get("message"),
    now: new Date(),
    actsAsStaff,
    where,
  });

  if (result.isErr()) {
    return reservationActionErrors({ where, userId: user.id }, result.error);
  }

  /*
   * 操作のあとは、いま見ていたカレンダーへ戻す（同じ内容の再送信を防ぐ PRG）。
   * `.` は URL の階層ではなく「いま表示しているルート」を指し、React Router がルートのパスから
   * 解決する（事務局の予約一覧と同じ）。施設と週を外さないよう、クエリは残す。
   */
  return redirect(`.${new URL(args.request.url).search}`);
}
