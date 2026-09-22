import { errAsync, okAsync, type ResultAsync } from "neverthrow";

import {
  GroupAction,
  GroupErrorCode,
  groupForbiddenMessages,
  groupPermissions,
  type GroupError,
  type GroupManageAction,
} from "~/domain/group";
import {
  canAct,
  type Actor,
  type MembershipError,
  type MembershipRepository,
} from "~/domain/membership";

/**
 * 団体が存在しないか、あるいは所属していない（存在秘匿）ときに返すエラー。
 *
 * 「所属していないグループ」と「存在しないグループ」で同じ値を返すことで、
 * グループ ID を総当たりされても、そのグループがあるかどうかを気取られないようにする（COND-011）。
 * そのため、この関数を通さずに個別のメッセージを書いてはいけない。
 */
export const groupNotFound = (): GroupError => ({
  code: GroupErrorCode.GroupNotFound,
  message: "グループが見つかりません。",
});

/** Membership の取得・更新で起きた DB エラーを GroupError に変換する */
export const toGroupDatabaseError = (error: MembershipError): GroupError => ({
  code: GroupErrorCode.DatabaseError,
  message: "メンバー情報の処理に失敗しました。",
  cause: error,
});

/** 認可の判定に必要な依存 */
export interface GroupAuthorizationDeps {
  readonly membershipRepository: MembershipRepository;
}

/** 誰がどの団体を操作しようとしているか */
export interface GroupAccessRequest {
  /** trim 済みの団体 ID */
  readonly groupId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。団体に所属していなくても操作できる */
  readonly isStaff: boolean;
}

/**
 * 操作する人を組み立てる。
 *
 * 事務局のときは所属を引かない。事務局は所属に関わらず全団体を管理でき（COND-009）、
 * 団体での役割を足しても許される操作が増えないので、D1 への往復を 1 回省ける。
 *
 * この省略が成り立つのは、groupPermissions の事務局の行が他の役割の行を
 * すべて含んでいる間だけである。前提が崩れたら気づけるよう、
 * group-authorization.test.ts でその包含を検証している。
 */
export const resolveGroupActor = (
  deps: GroupAuthorizationDeps,
  request: GroupAccessRequest,
): ResultAsync<Actor, GroupError> => {
  if (request.isStaff) {
    return okAsync<Actor, GroupError>({ isStaff: true, membership: null });
  }

  return deps.membershipRepository
    .findByGroupAndUser(request.groupId, request.actorUserId)
    .mapErr(toGroupDatabaseError)
    .map((membership): Actor => ({ isStaff: false, membership }));
};

/**
 * その団体を見られるかを確かめる。
 *
 * 見られないときに「権限がない」ではなく「見つからない」を返すのが要点（COND-011）。
 * 書き分けると、団体 ID を総当たりして存在を確かめられてしまう。
 */
export const ensureGroupIsVisible = (actor: Actor): ResultAsync<null, GroupError> =>
  canAct(groupPermissions, actor, GroupAction.View)
    ? okAsync<null, GroupError>(null)
    : errAsync(groupNotFound());

/**
 * 組み立て済みの操作する人が、その操作を許されているかを確かめる。
 *
 * 判定は 2 段階になる。団体を見る権限が無ければ存在を秘匿し（COND-011）、
 * 見る権限はあるがその操作が許されていなければ、何が足りないかを伝える。
 * 表が答えるのは「できるか」だけなので、どちらのエラーを返すかはここが決める。
 */
export const ensureActorCan = (
  actor: Actor,
  action: GroupManageAction,
): ResultAsync<null, GroupError> =>
  ensureGroupIsVisible(actor).andThen(() =>
    canAct(groupPermissions, actor, action)
      ? okAsync<null, GroupError>(null)
      : errAsync<null, GroupError>({
          code: GroupErrorCode.GroupForbidden,
          message: groupForbiddenMessages[action],
        }),
  );

/**
 * 所属を引いて、その操作が許されているかを確かめる。
 *
 * 団体を操作するユースケースの認可は、この 1 本を通すこと。
 * 同じ判定を各ユースケースに書き写すと、存在秘匿の扱いが少しずつ食い違っていく。
 */
export const ensureGroupPermission = (
  deps: GroupAuthorizationDeps,
  request: GroupAccessRequest,
  action: GroupManageAction,
): ResultAsync<null, GroupError> =>
  resolveGroupActor(deps, request).andThen((actor) => ensureActorCan(actor, action));
