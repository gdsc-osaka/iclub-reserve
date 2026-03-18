import { data, Form } from "react-router";
import type { Route } from "./+types/$id";
import { EmailPreviewModal } from "~/components/EmailPreviewModal";
import { getDb } from "~/db/client";
import {
  facilities,
  groups,
  memberships,
  messages,
  reservations,
  users,
} from "~/db/schema";
import { requireAuth } from "~/lib/auth";
import { collectPreviews, sendEmail } from "~/lib/email";
import { generateId } from "~/lib/id";
import { and, asc, eq, inArray } from "drizzle-orm";

export function meta() {
  return [{ title: "予約詳細 | iclub-reserve" }];
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = context.cloudflare;
  const session = await requireAuth(request, env);
  const db = getDb(env);

  const reservation = await db
    .select({
      id: reservations.id,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      headcount: reservations.headcount,
      note: reservations.note,
      status: reservations.status,
      statusReason: reservations.statusReason,
      createdAt: reservations.createdAt,
      facilityName: facilities.name,
      groupName: groups.name,
      groupId: reservations.groupId,
      createdBy: reservations.createdBy,
    })
    .from(reservations)
    .leftJoin(facilities, eq(reservations.facilityId, facilities.id))
    .leftJoin(groups, eq(reservations.groupId, groups.id))
    .where(eq(reservations.id, params.id))
    .get();

  if (!reservation) {
    throw new Response("Not Found", { status: 404 });
  }

  const messageList = await db
    .select({
      id: messages.id,
      body: messages.body,
      sentAt: messages.sentAt,
      senderName: users.name,
      senderIsStaff: users.isStaff,
    })
    .from(messages)
    .leftJoin(users, eq(messages.senderId, users.id))
    .where(eq(messages.reservationId, params.id))
    .orderBy(asc(messages.sentAt))
    .all();

  return data({ session, reservation, messageList });
}

// メール送信先を取得するヘルパー
async function getNotifyEmails(
  db: ReturnType<typeof getDb>,
  groupId: string,
  createdBy: string,
) {
  // 申請者のメールアドレス
  const creator = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, createdBy))
    .get();

  // 団体オーナーのメールアドレス
  const owners = await db
    .select({ email: users.email })
    .from(memberships)
    .leftJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.groupId, groupId),
        eq(memberships.role, "owner"),
      ),
    )
    .all();

  // 事務局のメールアドレス
  const staff = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.isStaff, true))
    .all();

  const ownerEmails = owners.map((o) => o.email).filter(Boolean) as string[];
  const staffEmails = staff.map((s) => s.email).filter(Boolean) as string[];
  const creatorEmail = creator?.email;

  return { creatorEmail, ownerEmails, staffEmails };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env } = context.cloudflare;
  const session = await requireAuth(request, env);
  const db = getDb(env);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  const reservation = await db
    .select()
    .from(reservations)
    .where(eq(reservations.id, params.id))
    .get();

  if (!reservation) {
    throw new Response("Not Found", { status: 404 });
  }

  const { creatorEmail, ownerEmails, staffEmails } = await getNotifyEmails(
    db,
    reservation.groupId,
    reservation.createdBy,
  );

  // 通知先メールアドレス（重複除去）
  const toGroupMembers = Array.from(
    new Set([creatorEmail, ...ownerEmails].filter(Boolean) as string[]),
  );
  const toAll = Array.from(
    new Set([...toGroupMembers, ...staffEmails]),
  );

  if (intent === "message") {
    const body = String(formData.get("body") ?? "").trim();
    if (!body)
      return data({ error: "メッセージを入力してください。" }, { status: 400 });

    await db.insert(messages).values({
      id: generateId(),
      reservationId: params.id,
      senderId: session.userId,
      body,
    });

    // メッセージ通知（EVT-008）
    const targets = session.isStaff ? toGroupMembers : staffEmails;
    const result = await sendEmail(env.RESEND_API_KEY, {
      to: targets,
      subject: `【iclub-reserve】予約にメッセージが届きました`,
      body: `<p>予約（${reservation.id}）にメッセージが届きました。</p><p>${body}</p>`,
    });

    return data({
      success: true,
      emailPreviews: collectPreviews([result]),
    });
  }

  if (intent === "withdraw" && reservation.status === "provisional") {
    await db
      .update(reservations)
      .set({ status: "withdrawn", updatedAt: new Date().toISOString() })
      .where(eq(reservations.id, params.id));

    // 取り消し通知（EVT-002）: 申請者・団体オーナーへ
    const result = await sendEmail(env.RESEND_API_KEY, {
      to: toGroupMembers,
      subject: "【iclub-reserve】仮予約を取り消しました",
      body: `<p>仮予約を取り消しました。</p>`,
    });

    return data({ success: true, emailPreviews: collectPreviews([result]) });
  }

  if (intent === "cancel" && reservation.status === "approved") {
    await db
      .update(reservations)
      .set({ status: "cancelled", updatedAt: new Date().toISOString() })
      .where(eq(reservations.id, params.id));

    // キャンセル通知（EVT-003）: 申請者・団体オーナー・事務局へ
    const result = await sendEmail(env.RESEND_API_KEY, {
      to: toAll,
      subject: "【iclub-reserve】承認済み予約がキャンセルされました",
      body: `<p>承認済み予約がキャンセルされました。</p>`,
    });

    return data({ success: true, emailPreviews: collectPreviews([result]) });
  }

  // 事務局専用操作
  if (session.isStaff) {
    if (intent === "approve" && reservation.status === "provisional") {
      await db
        .update(reservations)
        .set({ status: "approved", updatedAt: new Date().toISOString() })
        .where(eq(reservations.id, params.id));

      // 承認通知（EVT-005）: 申請者・団体オーナーへ
      const result = await sendEmail(env.RESEND_API_KEY, {
        to: toGroupMembers,
        subject: "【iclub-reserve】予約が承認されました",
        body: `<p>仮予約が承認され、施設利用が確定しました。</p>`,
      });

      return data({ success: true, emailPreviews: collectPreviews([result]) });
    }

    if (intent === "reject" && reservation.status === "provisional") {
      const reason = String(formData.get("reason") ?? "").trim();
      if (!reason)
        return data({ error: "却下理由を入力してください。" }, { status: 400 });

      await db
        .update(reservations)
        .set({
          status: "rejected",
          statusReason: reason,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(reservations.id, params.id));

      // 却下通知（EVT-006）: 申請者・団体オーナーへ
      const result = await sendEmail(env.RESEND_API_KEY, {
        to: toGroupMembers,
        subject: "【iclub-reserve】仮予約が却下されました",
        body: `<p>仮予約が却下されました。</p><p><strong>理由:</strong> ${reason}</p>`,
      });

      return data({ success: true, emailPreviews: collectPreviews([result]) });
    }

    if (intent === "cancel_by_staff" && reservation.status === "approved") {
      const reason = String(formData.get("reason") ?? "").trim();
      if (!reason)
        return data(
          { error: "キャンセル理由を入力してください。" },
          { status: 400 },
        );

      await db
        .update(reservations)
        .set({
          status: "cancelled_by_staff",
          statusReason: reason,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(reservations.id, params.id));

      // 事務局キャンセル通知（EVT-007）: 申請者・団体オーナーへ
      const result = await sendEmail(env.RESEND_API_KEY, {
        to: toGroupMembers,
        subject: "【iclub-reserve】予約が事務局によりキャンセルされました",
        body: `<p>予約が事務局によりキャンセルされました。</p><p><strong>理由:</strong> ${reason}</p>`,
      });

      return data({ success: true, emailPreviews: collectPreviews([result]) });
    }
  }

  return data({ error: "不正な操作です。" }, { status: 400 });
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  provisional: {
    label: "仮予約（承認待ち）",
    className: "bg-yellow-100 text-yellow-700",
  },
  approved: { label: "承認済み", className: "bg-green-100 text-green-700" },
  withdrawn: {
    label: "取り消し済み",
    className: "bg-gray-100 text-gray-600",
  },
  rejected: { label: "却下済み", className: "bg-red-100 text-red-700" },
  cancelled: {
    label: "キャンセル済み",
    className: "bg-gray-100 text-gray-600",
  },
  cancelled_by_staff: {
    label: "事務局キャンセル",
    className: "bg-red-100 text-red-700",
  },
};

export default function ReservationDetailPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { session, reservation, messageList } = loaderData;
  const status = STATUS_LABELS[reservation.status] ?? {
    label: reservation.status,
    className: "bg-gray-100 text-gray-600",
  };

  const isActive = ["provisional", "approved"].includes(reservation.status);
  const emailPreviews =
    actionData && "emailPreviews" in actionData
      ? actionData.emailPreviews ?? []
      : [];

  return (
    <div className="max-w-2xl">
      {/* デモ用メールプレビューモーダル */}
      {emailPreviews.length > 0 && (
        <EmailPreviewModal emails={emailPreviews} />
      )}

      <div className="flex items-center gap-3 mb-6">
        <a
          href="/reservations"
          className="text-gray-400 hover:text-gray-600 text-sm"
        >
          ← 予約一覧
        </a>
        <h1 className="text-xl font-bold text-gray-900">予約詳細</h1>
      </div>

      {actionData && "error" in actionData && actionData.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">
          {actionData.error}
        </div>
      )}

      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="font-medium text-gray-900">
              {reservation.facilityName}
            </h2>
            <p className="text-sm text-gray-500">{reservation.groupName}</p>
          </div>
          <span
            className={`text-xs px-2 py-1 rounded font-medium ${status.className}`}
          >
            {status.label}
          </span>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-gray-500">開始</dt>
            <dd className="font-medium">
              {new Date(reservation.startAt).toLocaleString("ja-JP")}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">終了</dt>
            <dd className="font-medium">
              {new Date(reservation.endAt).toLocaleString("ja-JP")}
            </dd>
          </div>
          {reservation.headcount && (
            <div>
              <dt className="text-gray-500">使用人数</dt>
              <dd className="font-medium">{reservation.headcount}名</dd>
            </div>
          )}
          {reservation.note && (
            <div className="col-span-2">
              <dt className="text-gray-500">備考</dt>
              <dd className="font-medium">{reservation.note}</dd>
            </div>
          )}
          {reservation.statusReason && (
            <div className="col-span-2">
              <dt className="text-gray-500">理由</dt>
              <dd className="font-medium text-red-600">
                {reservation.statusReason}
              </dd>
            </div>
          )}
        </dl>

        {/* アクションボタン */}
        {isActive && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-2">
            {reservation.status === "provisional" && !session.isStaff && (
              <Form method="post">
                <input type="hidden" name="intent" value="withdraw" />
                <button
                  type="submit"
                  className="text-sm text-red-600 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 transition-colors"
                  onClick={(e) => {
                    if (!confirm("仮予約を取り消しますか？")) e.preventDefault();
                  }}
                >
                  取り消す
                </button>
              </Form>
            )}
            {reservation.status === "approved" && !session.isStaff && (
              <Form method="post">
                <input type="hidden" name="intent" value="cancel" />
                <button
                  type="submit"
                  className="text-sm text-red-600 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 transition-colors"
                  onClick={(e) => {
                    if (!confirm("予約をキャンセルしますか？")) e.preventDefault();
                  }}
                >
                  キャンセルする
                </button>
              </Form>
            )}
            {session.isStaff && reservation.status === "provisional" && (
              <>
                <Form method="post">
                  <input type="hidden" name="intent" value="approve" />
                  <button
                    type="submit"
                    className="text-sm bg-green-600 text-white px-3 py-1.5 rounded hover:bg-green-700 transition-colors"
                  >
                    承認する
                  </button>
                </Form>
                <Form method="post" className="flex gap-2">
                  <input type="hidden" name="intent" value="reject" />
                  <input
                    type="text"
                    name="reason"
                    placeholder="却下理由（必須）"
                    className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    required
                  />
                  <button
                    type="submit"
                    className="text-sm text-red-600 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 transition-colors"
                  >
                    却下する
                  </button>
                </Form>
              </>
            )}
            {session.isStaff && reservation.status === "approved" && (
              <Form method="post" className="flex gap-2">
                <input type="hidden" name="intent" value="cancel_by_staff" />
                <input
                  type="text"
                  name="reason"
                  placeholder="キャンセル理由（必須）"
                  className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required
                />
                <button
                  type="submit"
                  className="text-sm text-red-600 border border-red-200 px-3 py-1.5 rounded hover:bg-red-50 transition-colors"
                >
                  キャンセルする
                </button>
              </Form>
            )}
          </div>
        )}
      </div>

      {/* メッセージ */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="font-medium text-gray-900 mb-4">メッセージ</h2>
        <div className="space-y-3 mb-4">
          {messageList.length === 0 ? (
            <p className="text-sm text-gray-400">メッセージはありません。</p>
          ) : (
            messageList.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2 ${msg.senderIsStaff ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`max-w-sm rounded-lg px-3 py-2 text-sm ${
                    msg.senderIsStaff
                      ? "bg-blue-100 text-blue-900"
                      : "bg-gray-100 text-gray-900"
                  }`}
                >
                  <p className="font-medium text-xs mb-1 opacity-60">
                    {msg.senderName} {msg.senderIsStaff && "（事務局）"}
                  </p>
                  <p>{msg.body}</p>
                </div>
              </div>
            ))
          )}
        </div>

        <Form method="post" className="flex gap-2">
          <input type="hidden" name="intent" value="message" />
          <input
            type="text"
            name="body"
            placeholder="メッセージを入力..."
            className="flex-1 border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            送信
          </button>
        </Form>
      </div>
    </div>
  );
}
