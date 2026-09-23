import type { ResultAsync } from "neverthrow";
import type { PermissionTable } from "../authz";
import { ErrorKind, type BaseError } from "../error";
import { MembershipRole, StaffRole, type ActorRole } from "../membership";

export const GroupStatus = {
  Enabled: "enabled",
  Pending: "pending",
  Disabled: "disabled",
} as const;
export type GroupStatus = (typeof GroupStatus)[keyof typeof GroupStatus];

export interface Group {
  id: string;
  name: string;
  status: GroupStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * グループに対して実行できる操作。
 *
 * ここに並べてよいのは「グループそのもの」への操作だけ。
 * 予約や施設への操作は、それぞれのドメインが自分の一覧を持つこと。
 * この表が権限の唯一の定義元であり、判定は canAct を通す。
 */
export const GroupAction = {
  /** グループ情報の閲覧 */
  View: "view",
  /** グループ情報の編集 */
  Update: "update",
  /** グループへのメンバー招待 */
  InviteMember: "invite_member",
  /** グループメンバーの役割変更 */
  UpdateMemberRole: "update_member_role",
  /** グループからのメンバー追放 */
  RemoveMember: "remove_member",
} as const;
export type GroupAction = (typeof GroupAction)[keyof typeof GroupAction];

/**
 * グループへの操作を誰に許すかの表。
 *
 * グループの権限のルールはこの表が唯一の定義元。
 * 判定するときは Membership の `canAct` にこの表を渡すこと。
 * この表を直接読むと「所属しているか」「事務局か」の判定が抜け落ちる。
 *
 * NOTE: グループの削除は意図的に含めていない。
 * 予約が紐づくグループを物理削除すると外部キー違反になるため、
 * 無効化 (GroupStatus.Disabled) で運用する。
 */
export const groupPermissions: PermissionTable<ActorRole, GroupAction> = {
  /*
   * 所属していない人には何ひとつ許さない (COND-011 団体情報の存在秘匿)。
   * 空であることがこの条件の表明なので、消さないこと。
   */
  base: [],
  byRole: {
    [MembershipRole.Admin]: [
      GroupAction.View,
      GroupAction.Update,
      GroupAction.InviteMember,
      GroupAction.RemoveMember,
      GroupAction.UpdateMemberRole,
    ],
    [MembershipRole.Member]: [GroupAction.View],
    /*
     * 事務局は所属に関わらず全団体を管理できる (COND-009)。
     * 管理者と同じ内容を書き写しているのは、二次的に導かれる値ではなく
     * それ自体が決定だから。管理者の権限を増やしたときに事務局も一緒に増えると、
     * 事務局に何を許したのかを誰も決めないまま広がってしまう。
     */
    [StaffRole]: [
      GroupAction.View,
      GroupAction.Update,
      GroupAction.InviteMember,
      GroupAction.RemoveMember,
      GroupAction.UpdateMemberRole,
    ],
  },
};

/**
 * 団体を見る以外の操作。
 *
 * 見る権限が無い相手への応答は存在秘匿に揃えるため（COND-011）、
 * 拒否のメッセージを持つのはこちらだけになる。
 */
export type GroupManageAction = Exclude<GroupAction, typeof GroupAction.View>;

/**
 * 団体を見られるのに、その操作は許されていないときに利用者へ出す文言（`userMessage`）。
 *
 * 画面ごとに文字列を書くと、同じ拒否が場所によって違う言い方で出てしまう。
 * 文言は必ずここを通すこと。
 *
 * View を持たないのは、見る権限すら無い相手には操作の可否を伝えないため。
 * その場合は `GroupErrorCode.NotVisible` を返し、画面の側が
 * 「団体が見つからない」に揃えて存在を秘匿する（COND-011）。
 */
export const groupForbiddenMessages: Record<GroupManageAction, string> = {
  [GroupAction.Update]: "団体情報を編集できるのは管理者と事務局だけです。",
  [GroupAction.InviteMember]: "メンバーを招待できるのは管理者と事務局だけです。",
  [GroupAction.UpdateMemberRole]: "メンバーの役割を変更できるのは管理者と事務局だけです。",
  [GroupAction.RemoveMember]: "メンバーを削除できるのは管理者と事務局だけです。",
};

/**
 * 団体まわりのエラーコード。
 *
 * 列挙子の名前は型名を繰り返さないが、文字列の値は変えないこと（ADR-004 決定 1）。
 * ログに出るのは値の方なので、変えると過去のログと突き合わせられなくなる。
 */
export const GroupErrorCode = {
  /** 団体が存在しない（事務局が引いたとき・ID が空のとき） */
  NotFound: "GROUP_NOT_FOUND",
  /**
   * 所属していないので見せない。
   *
   * その ID の団体が存在するかどうかは確かめていない。確かめると、存在する団体のときだけ
   * DB への往復が 1 回増え、応答時間の差から存在が漏れるため。
   * したがってこのコードは「所属の無い団体 ID を開こうとした」ことだけを表し、
   * 打ち間違いと総当たりの両方を含む。見分けるのは利用者ごとの件数である（ADR-004 決定 9）。
   *
   * 利用者には `NotFound` と同じ応答を返す（COND-011）。ユースケースが `NotFound` に
   * 潰さずに正直に返すのは、サーバーのログでは権限の無いアクセスとして残したいため。
   * 秘匿は画面の側（`app/routes/_shared/group-error.server.ts`）が行う（ADR-004 決定 4）。
   */
  NotVisible: "GROUP_NOT_VISIBLE",
  /** 団体を見られるが、その操作をする権限が無い */
  Forbidden: "GROUP_FORBIDDEN",
  /** 入力された値が不正（団体名が空・役割が不正など） */
  InvalidInput: "GROUP_INVALID_INPUT",
  /** 操作の対象にしたメンバーが、その団体に居ない */
  MemberNotFound: "MEMBER_NOT_FOUND",
  /** 操作の対象にした招待が、その団体に無い（すでに取り消された・承諾された・期限切れなど） */
  InvitationNotFound: "INVITATION_NOT_FOUND",
  /** その操作をすると団体の管理者が 0 人になってしまう */
  LastAdminRequired: "LAST_ADMIN_REQUIRED",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type GroupErrorCode = (typeof GroupErrorCode)[keyof typeof GroupErrorCode];

/**
 * 団体まわりのエラーコードの分類（ADR-004 決定 3）。
 *
 * HTTP の status とログのレベルは、この表から決まる。
 * `NotVisible` を `not_found` にしないこと。ログで総当たりを見つけるには
 * `forbidden`（warn）として残る必要がある。利用者への応答を 404 に揃えるのは画面の側の仕事である。
 */
export const groupErrorKind: Record<GroupErrorCode, ErrorKind> = {
  [GroupErrorCode.NotFound]: ErrorKind.NotFound,
  [GroupErrorCode.NotVisible]: ErrorKind.Forbidden,
  [GroupErrorCode.Forbidden]: ErrorKind.Forbidden,
  [GroupErrorCode.InvalidInput]: ErrorKind.InvalidInput,
  [GroupErrorCode.MemberNotFound]: ErrorKind.NotFound,
  [GroupErrorCode.InvitationNotFound]: ErrorKind.NotFound,
  [GroupErrorCode.LastAdminRequired]: ErrorKind.Conflict,
  [GroupErrorCode.DatabaseError]: ErrorKind.Internal,
};

/**
 * 入力の誤りが、どの項目についてのものか（ADR-004 決定 6）。
 *
 * 画面の入力欄の名前ではなく、ドメインの語彙で書く。どの欄の下に出すかは、
 * 画面ごとにこの値から自分の欄を引く表を持って決める。
 *
 * `*Input` ではなく `*Field` としているのは、`UpdateGroupNameInput` のような
 * 「ユースケースへの入力」を表す型と名前がぶつからないようにするため。
 */
export const GroupField = {
  /** 団体名 */
  Name: "group_name",
  /** 招待するメールアドレス */
  InviteeEmail: "invitee_email",
  /** 団体での役割（招待・役割の変更） */
  MemberRole: "member_role",
} as const;
export type GroupField = (typeof GroupField)[keyof typeof GroupField];

export interface GroupError extends BaseError {
  readonly code: GroupErrorCode;
  /** 入力の誤りのとき、どの項目についての誤りか。画面が欄を決めるのに使う */
  readonly field?: GroupField;
}

/** 団体名の更新に必要な値。触ってよい列だけを並べる */
export interface UpdateGroupNameInput {
  readonly id: string;
  /**
   * 検証済みの団体名（`validateGroupName` を通したもの）。
   *
   * ここへ渡ってくる時点で検証済みであること。
   * 検証はドメインの `validateGroupName` が唯一の担当で、リポジトリでは確かめ直さない。
   */
  readonly name: string;
  readonly updatedAt: Date;
}

/**
 * 団体の新規作成に必要な値。
 *
 * `status` を受け取らないのは、作成時の状態が常に pending だから（STATE-002）。
 * 引数で渡せるようにすると、フォームから届いた値がそのまま状態になる経路ができてしまい、
 * 事務局の承認を飛ばして enabled の団体を作れてしまう（COND-006）。
 */
export interface CreateGroupInput {
  readonly id: string;
  /** 検証済みの団体名（`validateGroupName` を通したもの） */
  readonly name: string;
  /** 初期の管理者になる人（REQ-016） */
  readonly ownerUserId: string;
  /** 作成する group_member 行の ID */
  readonly membershipId: string;
  /** createdAt / updatedAt に書き込む時刻 */
  readonly now: Date;
}

export interface GroupRepository {
  findById(id: string): ResultAsync<Group, GroupError>;
  updateName(input: UpdateGroupNameInput): ResultAsync<Group, GroupError>;
  /**
   * 団体と初期メンバーを 1 つの `db.batch()` で作成する。
   *
   * `group_member` も同時に書き込むが、2 つの文を 1 つの batch に載せて
   * トランザクション整合性を保つ必要があるため、GroupRepository のメソッドとして配置している
   * （`invitation-repo.ts` の `accept` と同様の構成）。
   */
  create(input: CreateGroupInput): ResultAsync<Group, GroupError>;
}
