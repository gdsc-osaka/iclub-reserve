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
import type { QueryError } from "~/query/error";

/**
 * 団体が存在しないときに返すエラー。
 *
 * 所属していなくて見られないときは、こちらではなく `groupNotVisible` を返すこと。
 * 利用者への応答はどちらも同じ 404 になるが（COND-011）、それを揃えるのは画面の側で、
 * ユースケースは起きたことをそのまま返す（ADR-004 決定 4）。
 */
export const groupNotFound = (): GroupError => ({
  code: GroupErrorCode.NotFound,
  message: "団体が見つからない。",
});

/**
 * 所属していないので見せないときに返すエラー。
 *
 * その ID の団体が存在するかは確かめない。確かめると応答時間の差から存在が漏れる（`ensureGroupIsVisible`）。
 * `groupNotFound` と分けているのは、所属の無い団体 ID へのアクセスを
 * サーバーのログに権限の問題（warn）として残すため。打ち間違いか総当たりかは、利用者ごとの件数で見分ける。
 * 利用者に見せる応答を `NotFound` と同じにする（COND-011）のは
 * `app/routes/_shared/group-error.server.ts` の表で、2 つの応答が同じになることをテストで固定している。
 *
 * `userMessage` を持たせないこと。持たせても画面には出ないが、
 * 「見られない理由」を書く場所があると、いつか誰かが書いてしまう。
 */
export const groupNotVisible = (): GroupError => ({
  code: GroupErrorCode.NotVisible,
  message: "所属の無い団体を開こうとした（団体が存在するかは確かめていない）。",
});

/**
 * 団体まわりの読み書きで起きた DB エラーを GroupError に変換する。
 *
 * 所属 (Membership) の読み書きと、団体管理画面の Query の両方をここで受ける。
 * 失敗した場所ごとに文言を書き分けていないのは、この `message` がログにしか出ないため。
 * 画面に出る文言は `DatabaseError` として一律に差し替えられる（`app/routes/_shared/group-error.server.ts`）。
 * どこで失敗したかはログの `where` と、ここに詰めた `cause` が持っている。
 *
 * ユースケースごとに同じ変換を書き直さないこと。文言が増えるだけで、
 * ログから読み取れることは変わらない。
 */
export const toGroupDatabaseError = (error: MembershipError | QueryError): GroupError => ({
  code: GroupErrorCode.DatabaseError,
  message: "団体の情報を読み書きできませんでした。",
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
 * 見られないときは `NotVisible` を返す。利用者には「見つからない」と答える必要があるが（COND-011）、
 * それは画面の側が行う。ここで `NotFound` に潰すと、ログで総当たりを見つけられなくなる。
 */
export const ensureGroupIsVisible = (actor: Actor): ResultAsync<null, GroupError> =>
  canAct(groupPermissions, actor, GroupAction.View)
    ? okAsync<null, GroupError>(null)
    : errAsync(groupNotVisible());

/**
 * 組み立て済みの操作する人が、その操作を許されているかを確かめる。
 *
 * 判定は 2 段階になる。団体を見る権限が無ければ `NotVisible` を返し（画面の側で秘匿する。COND-011）、
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
          code: GroupErrorCode.Forbidden,
          message: `許されていない操作 (${action}) を拒否した。`,
          userMessage: groupForbiddenMessages[action],
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
