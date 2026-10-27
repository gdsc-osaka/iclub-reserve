import { env } from "cloudflare:workers";
import { redirect, type RouterContextProvider } from "react-router";

import { GroupField } from "~/domain/group";
import { createGroupAuditLogListQuery } from "~/infra/audit-log/group-audit-log-list-query";
import { createGroupCalendarFeedRepository } from "~/infra/calendar/group-calendar-feed-repo";
import { createDb } from "~/infra/db";
import { createGroupInvitationListQuery } from "~/infra/group/group-invitation-list-query";
import { createGroupMemberListQuery } from "~/infra/group/group-member-list-query";
import { createGroupRepository } from "~/infra/group/group-repo";
import { createInvitationRepository } from "~/infra/invitation/invitation-repo";
import { createQueueMailOutboxNotifier } from "~/infra/mail/mail-queue.server";
import { createMembershipRepository } from "~/infra/membership/membership-repo";
import { type AppArea, toAreaDashboardPath } from "~/lib/app-area";
import { resolveAppBaseUrl } from "~/lib/app-url.server";
import { parseHistoryPage } from "~/lib/history-page";
import { generateRandomToken } from "~/lib/random-token";
import { requireAreaUser, toAreaWhere } from "~/routes/_shared/app-area.server";
import { groupActionErrors, groupErrorResponse } from "~/routes/_shared/group-error.server";
import { issueGroupCalendarFeedUseCase } from "~/usecases/calendar/issue-group-calendar-feed";
import { regenerateGroupCalendarFeedUseCase } from "~/usecases/calendar/regenerate-group-calendar-feed";
import { cancelInvitationUseCase } from "~/usecases/group/cancel-invitation";
import { getGroupManagementUseCase } from "~/usecases/group/get-group-management";
import { inviteMemberUseCase } from "~/usecases/group/invite-member";
import { removeMemberUseCase } from "~/usecases/group/remove-member";
import { updateGroupNameUseCase } from "~/usecases/group/update-group-name";
import { updateMemberRoleUseCase } from "~/usecases/group/update-member-role";

import type { GroupActionData } from "./action-data";

export interface LoadGroupDetailArgs {
  readonly request: Request;
  readonly context: Readonly<RouterContextProvider>;
  readonly groupId: string;
}

/**
 * 団体管理画面（SCR-007）のローダー。利用者の画面と事務局の画面のルートが、どちらの画面かを渡して呼ぶ（ADR-016 決定 10）。
 *
 * 閲覧権限（所属メンバーまたは事務局スタッフ）を確認し、団体情報・所属メンバー・承諾待ち招待を取得する。
 * 所属していない人には存在自体を伏せるため、権限不足ではなく 404 を返す（COND-011 存在の秘匿）。
 * 画面に渡す isStaff（操作履歴の操作者の出し方）は、開いている画面で決める（ADR-016 決定 18）。
 */
export async function loadGroupDetail(args: LoadGroupDetailArgs, area: AppArea) {
  const where = toAreaWhere(area, "groups.detail.loader");
  // この画面はログイン必須 (root.tsx のミドルウェアが先に確認している)。事務局の画面は事務局でなければ 403
  const { user, actsAsStaff } = await requireAreaUser(args.context, area, where);
  const now = new Date();
  const db = createDb(env.DB);
  const auditLogPage = parseHistoryPage(args.request);

  const result = await getGroupManagementUseCase(
    {
      groupRepository: createGroupRepository(db),
      membershipRepository: createMembershipRepository(db),
      groupCalendarFeedRepository: createGroupCalendarFeedRepository(db),
      groupMemberListQuery: createGroupMemberListQuery(db),
      groupInvitationListQuery: createGroupInvitationListQuery(db),
      groupAuditLogListQuery: createGroupAuditLogListQuery(db),
    },
    {
      groupId: args.groupId,
      actorUserId: user.id,
      isStaff: actsAsStaff,
      now,
      auditLogPage,
    },
  );

  if (result.isErr()) {
    // 見られない団体も、無い団体と同じ 404 になる（COND-011）。揃えるのは表の側
    throw groupErrorResponse({ where, userId: user.id }, result.error);
  }

  return {
    view: result.value,
    now,
    currentUserId: user.id,
    isStaff: actsAsStaff,
    appBaseUrl: resolveAppBaseUrl(args.request),
    area,
  };
}

export interface HandleGroupDetailActionArgs {
  readonly request: Request;
  readonly context: Readonly<RouterContextProvider>;
  readonly groupId: string;
}

/**
 * 団体管理画面のアクション。ローダーと同じく、2 つのルートが画面を渡して呼ぶ。
 *
 * 団体名の編集、メンバーの役割変更（昇格・降格）、メンバーの削除、
 * およびメンバーの招待送信・招待取り消しなどの更新操作を処理する。
 * 見る人自身のカレンダー購読 URL の発行・作り直し（UC-039）もここで受ける。
 */
export async function handleGroupDetailAction(args: HandleGroupDetailActionArgs, area: AppArea) {
  const where = toAreaWhere(area, "groups.detail");
  const { user, actsAsStaff } = await requireAreaUser(args.context, area, `${where}.action`);
  const formData = await args.request.formData();
  const intent = formData.get("intent");
  const groupId = args.groupId;

  const db = createDb(env.DB);

  /*
   * ログの where に操作の種類まで入れて、どの操作で失敗したかを絞り込めるようにする。
   * 団体が無い・見られないときは、どの操作でもグルーが loader と同じ 404 を投げる（COND-011）。
   * ローダーが 404 を返す状況で action だけ 200 を返すと、応答の違いから団体の有無を推測できてしまうため。
   */
  const contextOf = (operation: string) => ({
    where: `${where}.${operation}`,
    userId: user.id,
  });

  // 1. 団体名の変更
  if (intent === "update-group-name") {
    const rawName = formData.get("name");
    const submittedName = typeof rawName === "string" ? rawName : "";

    const result = await updateGroupNameUseCase(
      {
        groupRepository: createGroupRepository(db),
        membershipRepository: createMembershipRepository(db),
      },
      {
        groupId,
        actorUserId: user.id,
        isStaff: actsAsStaff,
        name: submittedName,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      return {
        section: "name",
        submittedName,
        ...groupActionErrors(contextOf("update-group-name"), result.error, {
          [GroupField.Name]: "nameError",
        }),
      } satisfies GroupActionData;
    }

    // 同じ内容の再送信を防ぐ PRG。戻ったあとはローダーが新しい名前を読み直す
    return redirect(".");
  }

  // 2. メンバーの役割変更（昇格・降格）
  if (intent === "update-member-role") {
    const rawUserId = formData.get("user_id");
    const targetUserId = typeof rawUserId === "string" ? rawUserId : "";
    const rawRole = formData.get("role");
    const role = typeof rawRole === "string" ? rawRole : "";

    const result = await updateMemberRoleUseCase(
      {
        membershipRepository: createMembershipRepository(db),
      },
      {
        groupId,
        actorUserId: user.id,
        isStaff: actsAsStaff,
        targetUserId,
        role,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      // 役割は選択肢から選ぶので、欄の下に出す先が無い。誤りはすべてメンバー欄の上に出す
      return {
        section: "members",
        ...groupActionErrors(contextOf("update-member-role"), result.error),
      } satisfies GroupActionData;
    }

    return redirect(".");
  }

  // 3. メンバーの削除
  if (intent === "remove-member") {
    const rawUserId = formData.get("user_id");
    const targetUserId = typeof rawUserId === "string" ? rawUserId : "";

    const result = await removeMemberUseCase(
      {
        membershipRepository: createMembershipRepository(db),
      },
      {
        groupId,
        actorUserId: user.id,
        isStaff: actsAsStaff,
        targetUserId,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      return {
        section: "members",
        ...groupActionErrors(contextOf("remove-member"), result.error),
      } satisfies GroupActionData;
    }

    /*
     * 自分自身を削除した場合の遷移先（UC-011・ADR-016 決定 15）:
     * 利用者の画面では、事務局であっても団体のメンバーとして見ているので（COND-030 の (1)）、
     * 自分を外すとその団体を見る権限を失う。
     * そのまま "."（この画面）にリダイレクトすると、閲覧権限がないためローダーが 404 を返し、
     * 操作は正常に成功したにもかかわらず「団体が見つかりません」というエラー画面が表示されてしまう。
     * 利用者に失敗したような誤解を与えないよう、ダッシュボード（"/"）へ戻す。
     * 事務局の画面では所属に関わらず団体を見られるので、下の "." でこの画面に残す。
     */
    if (result.value.removedUserId === user.id && !actsAsStaff) {
      return redirect(toAreaDashboardPath(area));
    }

    return redirect(".");
  }

  // 4. 招待の送信
  if (intent === "invite-member") {
    const rawEmail = formData.get("email");
    const submittedEmail = typeof rawEmail === "string" ? rawEmail : "";
    const rawRole = formData.get("role");
    const submittedRole = typeof rawRole === "string" ? rawRole : "";

    const result = await inviteMemberUseCase(
      {
        groupRepository: createGroupRepository(db),
        membershipRepository: createMembershipRepository(db),
        invitationRepository: createInvitationRepository(db),
        mailOutboxNotifier: createQueueMailOutboxNotifier(),
      },
      {
        groupId,
        actorUserId: user.id,
        isStaff: actsAsStaff,
        email: submittedEmail,
        role: submittedRole,
        now: new Date(),
        appBaseUrl: resolveAppBaseUrl(args.request),
      },
    );

    if (result.isErr()) {
      return {
        section: "invite",
        submittedEmail,
        submittedRole,
        /*
         * 役割（MemberRole）は載せない。この画面では選択肢から選ぶので、欄の下に出す先が無い。
         * 載せずにおけばフォームの上に出る。メールアドレス欄の下に出すと、どの欄の誤りか分からなくなる。
         */
        ...groupActionErrors(contextOf("invite-member"), result.error, {
          [GroupField.InviteeEmail]: "emailError",
        }),
      } satisfies GroupActionData;
    }

    return redirect(".");
  }

  // 5. 招待の取り消し
  if (intent === "cancel-invitation") {
    const rawInvitationId = formData.get("invitation_id");
    const invitationId = typeof rawInvitationId === "string" ? rawInvitationId : "";

    const result = await cancelInvitationUseCase(
      {
        membershipRepository: createMembershipRepository(db),
        invitationRepository: createInvitationRepository(db),
      },
      {
        groupId,
        actorUserId: user.id,
        isStaff: actsAsStaff,
        invitationId,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      return {
        section: "invitations",
        ...groupActionErrors(contextOf("cancel-invitation"), result.error),
      } satisfies GroupActionData;
    }

    return redirect(".");
  }

  // 6. カレンダー購読 URL の発行
  if (intent === "issue-calendar-feed") {
    const result = await issueGroupCalendarFeedUseCase(
      {
        groupRepository: createGroupRepository(db),
        membershipRepository: createMembershipRepository(db),
        groupCalendarFeedRepository: createGroupCalendarFeedRepository(db),
        generateToken: generateRandomToken,
      },
      {
        groupId,
        actorUserId: user.id,
        isStaff: actsAsStaff,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      return {
        section: "calendar-feed",
        ...groupActionErrors(contextOf("issue-calendar-feed"), result.error),
      } satisfies GroupActionData;
    }

    return redirect(".");
  }

  // 7. カレンダー購読 URL の作り直し
  if (intent === "regenerate-calendar-feed") {
    const result = await regenerateGroupCalendarFeedUseCase(
      {
        groupRepository: createGroupRepository(db),
        membershipRepository: createMembershipRepository(db),
        groupCalendarFeedRepository: createGroupCalendarFeedRepository(db),
        generateToken: generateRandomToken,
      },
      {
        groupId,
        actorUserId: user.id,
        isStaff: actsAsStaff,
        now: new Date(),
      },
    );

    if (result.isErr()) {
      return {
        section: "calendar-feed",
        ...groupActionErrors(contextOf("regenerate-calendar-feed"), result.error),
      } satisfies GroupActionData;
    }

    return redirect(".");
  }

  // この画面が出している操作以外は受け付けない
  return {
    section: "name",
    submittedName: "",
    nameError: null,
    formError: "この操作は受け付けられませんでした。画面を読み込み直してください。",
  } satisfies GroupActionData;
}
