import { env } from "cloudflare:workers";
import { createEmailChangedMailDraft } from "~/domain/mail/email-changed-mail";
import { createInvitationMailDraft } from "~/domain/mail/invitation-mail";
import { escapeHtml } from "~/domain/mail/mail-content-html";
import type { MailDraft } from "~/domain/mail/mail-outbox";
import {
  createReservationMailDrafts,
  ReservationMailEvent,
  type ReservationMailRecipient,
  type ReservationMailSubject,
} from "~/domain/mail/reservation-mail";
import {
  createReservationMessageMailDrafts,
  type CreateReservationMessageMailDraftsArgs,
} from "~/domain/mail/reservation-message-mail";
import { createStaffInvitationMailDraft } from "~/domain/mail/staff-invitation-mail";
import { MembershipRole } from "~/domain/membership";
import { UnlockArrangement } from "~/domain/reservation";
import { toVerificationOtpMail } from "~/usecases/mail/send-verification-otp.server";
import type { Route } from "./+types/route";

/*
 * 見本の値。利用者が入力する項目（理由・メッセージ・団体名・氏名）には、HTML の記号と改行を入れてある。
 * HTML 版でエスケープされ、文字のまま出ることを目で確かめるため。
 */

const APP_BASE_URL = "http://localhost:5173";

const groupMember: ReservationMailRecipient = {
  userId: "usr_member_1",
  address: "member@example.com",
  name: '山田 太郎 & "メンバー" <taro>',
};

const staff: ReservationMailRecipient = {
  userId: "usr_staff_1",
  address: "staff@example.com",
  name: "阪大 花子",
};

const sampleReservation: ReservationMailSubject = {
  id: "tz4a98xxat96iws9zmbrgj3a",
  facilityName: "イノベーションルーム A",
  groupName: "ロボット研究会 <R&D>",
  startAt: new Date("2026-11-15T13:00:00+09:00"),
  endAt: new Date("2026-11-15T15:00:00+09:00"),
  statusReason: null,
  unlockArrangement: null,
  updatedAt: new Date("2026-11-10T12:00:00+09:00"),
};

const SAMPLE_REASON =
  'サークルの<b>予定</b>が変わったため & "別の日"に申請し直します。\n2 行目の理由です。';
const SAMPLE_MESSAGE =
  '鍵は前日に守衛室で受け取ってください。<script>alert(1)</script>\n大切に<b>保管</b>してください & "紛失注意"。';

/** 見本として出す本文。組み立て関数が返した 1 通目を使う */
interface MailBodies {
  readonly text: string;
  readonly html: string;
}

const toBodies = (draft: MailDraft | undefined): MailBodies => ({
  text: draft?.text ?? "",
  html: draft?.html ?? "",
});

/** 予約の通知（団体側の宛先に届くもの）の見本 */
const reservationSample = (
  event: ReservationMailEvent,
  overrides: Partial<ReservationMailSubject> = {},
  message: string | null = null,
): MailBodies =>
  toBodies(
    createReservationMailDrafts(
      event,
      { ...sampleReservation, ...overrides },
      { groupMembers: [groupMember], staff: [staff] },
      APP_BASE_URL,
      message,
    )[0],
  );

/** メッセージ通知の見本 */
const messageSample = (
  args: Pick<CreateReservationMessageMailDraftsArgs, "senderName" | "recipients"> & {
    readonly sentAsStaff: boolean;
    readonly unlockArrangement?: UnlockArrangement;
  },
): MailBodies =>
  toBodies(
    createReservationMessageMailDrafts({
      message: {
        id: "msg_sample",
        reservationId: sampleReservation.id,
        senderId: args.sentAsStaff ? "usr_staff_1" : "usr_member_1",
        sentAsStaff: args.sentAsStaff,
        body: SAMPLE_MESSAGE,
        sentAt: new Date("2026-11-10T14:00:00+09:00"),
      },
      reservation: sampleReservation,
      senderName: args.senderName,
      recipients: args.recipients,
      appBaseUrl: APP_BASE_URL,
      ...(args.unlockArrangement ? { unlockArrangement: args.unlockArrangement } : {}),
    })[0],
  );

interface MailSample {
  readonly title: string;
  readonly build: () => MailBodies;
}

/** 見本の一覧。キーが `?mail=` に入る名前 */
const samples = new Map<string, MailSample>([
  [
    "reservation-applied",
    { title: "予約の通知: 申請", build: () => reservationSample(ReservationMailEvent.Applied) },
  ],
  [
    "reservation-withdrawn",
    {
      title: "予約の通知: 仮予約の取り消し（理由あり）",
      build: () =>
        reservationSample(ReservationMailEvent.Withdrawn, { statusReason: SAMPLE_REASON }),
    },
  ],
  [
    "reservation-cancelled",
    {
      title: "予約の通知: キャンセル（理由あり）",
      build: () =>
        reservationSample(ReservationMailEvent.Cancelled, { statusReason: SAMPLE_REASON }),
    },
  ],
  [
    "reservation-approved",
    { title: "予約の通知: 承認", build: () => reservationSample(ReservationMailEvent.Approved) },
  ],
  [
    "reservation-approved-unlock-and-message",
    {
      title: "予約の通知: 承認（解錠の手配が要手配・メッセージ付き）",
      build: () =>
        reservationSample(
          ReservationMailEvent.Approved,
          { unlockArrangement: UnlockArrangement.Required },
          SAMPLE_MESSAGE,
        ),
    },
  ],
  [
    "reservation-rejected",
    {
      title: "予約の通知: 却下（理由あり）",
      build: () =>
        reservationSample(ReservationMailEvent.Rejected, { statusReason: SAMPLE_REASON }),
    },
  ],
  [
    "reservation-cancelled-by-staff",
    {
      title: "予約の通知: 事務局によるキャンセル（理由あり）",
      build: () =>
        reservationSample(ReservationMailEvent.CancelledByStaff, { statusReason: SAMPLE_REASON }),
    },
  ],
  [
    "reservation-approved-edited",
    {
      title: "予約の通知: 承認済みの予約の変更（承認済みのまま）",
      build: () => reservationSample(ReservationMailEvent.ApprovedEdited),
    },
  ],
  [
    "reservation-reapproval-requested",
    {
      title: "予約の通知: 承認済みの予約の変更（再承認待ち）",
      build: () => reservationSample(ReservationMailEvent.ReapprovalRequested),
    },
  ],
  [
    "reservation-provisional-edited",
    {
      title: "予約の通知: 仮予約の変更",
      build: () => reservationSample(ReservationMailEvent.ProvisionalEdited),
    },
  ],
  [
    "reservation-edited-by-staff",
    {
      title: "予約の通知: 事務局による変更",
      build: () => reservationSample(ReservationMailEvent.EditedByStaff),
    },
  ],
  [
    "reservation-message-from-group",
    {
      title: "メッセージ通知: 団体側からの送信（事務局宛て）",
      build: () =>
        messageSample({
          sentAsStaff: false,
          senderName: groupMember.name ?? "",
          recipients: [staff],
        }),
    },
  ],
  [
    "reservation-message-from-staff",
    {
      title: "メッセージ通知: 事務局としての送信（団体宛て）",
      build: () =>
        messageSample({
          sentAsStaff: true,
          senderName: staff.name ?? "",
          recipients: [groupMember],
        }),
    },
  ],
  [
    "reservation-message-with-unlock",
    {
      title: "メッセージ通知: 解錠の手配の更新付き",
      build: () =>
        messageSample({
          sentAsStaff: true,
          senderName: staff.name ?? "",
          recipients: [groupMember],
          unlockArrangement: UnlockArrangement.Arranged,
        }),
    },
  ],
  [
    "invitation",
    {
      title: "団体への招待",
      build: () =>
        toBodies(
          createInvitationMailDraft({
            invitationId: "inv_sample_456",
            groupName: 'ロボット<b>研究会</b> & "AI ラボ"',
            email: "invitee@ecs.osaka-u.ac.jp",
            role: MembershipRole.Admin,
            expiresAt: new Date("2026-11-17T23:59:00+09:00"),
            appBaseUrl: APP_BASE_URL,
          }),
        ),
    },
  ],
  [
    "staff-invitation",
    {
      title: "事務局への招待",
      build: () =>
        toBodies(
          createStaffInvitationMailDraft({
            invitationId: "inv_staff_sample_789",
            email: "new-staff@office.osaka-u.ac.jp",
            expiresAt: new Date("2026-11-17T23:59:00+09:00"),
            appBaseUrl: APP_BASE_URL,
          }),
        ),
    },
  ],
  [
    "email-changed",
    {
      title: "メールアドレス変更の通知",
      build: () =>
        toBodies(
          createEmailChangedMailDraft({
            userId: "usr_sample_123",
            userName: groupMember.name ?? "",
            previousEmail: "before@ecs.osaka-u.ac.jp",
            newEmail: "after@ecs.osaka-u.ac.jp",
            changedAt: new Date("2026-11-10T16:00:00+09:00"),
            staffContactEmail: "staff@example.com",
          }),
        ),
    },
  ],
  [
    "otp-sign-in",
    {
      title: "認証コード（ログイン）",
      build: () => toVerificationOtpMail({ otp: "849201", type: "sign-in" }),
    },
  ],
]);

/** 見本の一覧のページ。見本ごとに、HTML 版とテキスト版へのリンクを並べる */
const renderIndex = (): string => {
  const items = Array.from(samples, ([name, sample]) => {
    const query = `?mail=${encodeURIComponent(name)}`;
    return `<li>${escapeHtml(sample.title)}: <a href="${query}">HTML 版</a> / <a href="${query}&amp;format=text">テキスト版</a></li>`;
  }).join("");

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>メールの見本（開発専用）</title></head><body><h1>メールの見本（開発専用）</h1><ul>${items}</ul></body></html>`;
};

/**
 * 開発専用の、メールの文面の見本を表示するエンドポイント（ADR-018）。
 *
 * メールは実際に送らないと見た目を確かめられないので、各メールの組み立て関数に見本の値を渡した結果を、
 * ブラウザーでそのまま開けるようにする。`?mail=<名前>` で HTML 版、`&format=text` を付けるとテキスト版を返す。
 * 本番やプレビューでは要らないうえ、文面を外から読めてしまうため、
 * APP_ENV が local 以外のときは 404 を返す。
 */
export async function loader({ request }: Route.LoaderArgs) {
  if (env.APP_ENV !== "local") {
    throw new Response(null, { status: 404 });
  }

  const url = new URL(request.url);
  const name = url.searchParams.get("mail");

  if (name === null) {
    return new Response(renderIndex(), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const sample = samples.get(name);
  if (sample === undefined) {
    throw new Response(null, { status: 404 });
  }

  const { text, html } = sample.build();

  return url.searchParams.get("format") === "text"
    ? new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
    : new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
