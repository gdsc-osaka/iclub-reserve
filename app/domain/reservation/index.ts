import type { ResultAsync } from "neverthrow";

import type { PermissionTable } from "../authz";
import { ErrorKind, type BaseError } from "../error";
import type { MailDraft } from "../mail/mail-outbox";
import { MembershipRole, StaffRole, type ActorRole } from "../membership";

export const ReservationStatus = {
  Provisional: "provisional",
  Approved: "approved",
  Withdrawn: "withdrawn",
  Rejected: "rejected",
  Cancelled: "cancelled",
  CancelledByStaff: "cancelled_by_staff",
} as const;

export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

export interface Reservation {
  id: string;
  facilityId: string;
  groupId: string;
  startAt: Date;
  endAt: Date;
  headCount: number;
  note: string | null;
  status: ReservationStatus;
  statusReason: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export const ReservationAction = {
  /**
   * 概要（施設・日時・団体名・ステータス）を見る（COND-008）。
   *
   * 予約そのものを開けるかどうかは、この操作が許されるかで決まる。
   */
  ViewSummary: "view_summary",
  /**
   * 詳しい項目（使用人数・備考・却下/キャンセル理由・作成者・メッセージ）まで見る（COND-008）。
   *
   * ViewSummary とは別の操作にしてある。1 つにまとめて「見られるか」だけを問うと、
   * 表からは 2 段階に分かれていることが読み取れなくなる。
   */
  ViewDetail: "view_detail",
  CreateProvisional: "create_provisional",
  Withdraw: "withdraw",
  Cancel: "cancel",
  /**
   * 団体として予約の内容（施設・日時・使用人数・備考）を変える（UC-005 / UC-017）。
   *
   * 変えられる状態か・開始前かは、この表ではなく edit.ts の canEditReservation が見る。
   */
  Edit: "edit",
  /**
   * 事務局として承認済みの予約を直接作成する（UC-008）。
   *
   * 承認フローを経ずに最初から承認済み（STATE-001）で作る。
   * 団体メンバーには許されず、事務局だけに許される操作（COND-009）。
   */
  CreateDirect: "create_direct",
} as const;
export type ReservationAction = (typeof ReservationAction)[keyof typeof ReservationAction];

/**
 * 予約への操作を誰に許すかの表。
 *
 * 承認・却下・事務局キャンセルはここに無い。状態を遷移させる操作なので、
 * どの状態からどの状態へ動かせるかと一体で transition.ts の transitionAuthority が持つ。
 *
 * 判定するときは Membership の `canAct` にこの表を渡すこと。
 */
export const reservationPermissions: PermissionTable<ActorRole, ReservationAction> = {
  /*
   * 所属していない人でも、予約の概要は見られる (COND-008)。
   * 空き状況カレンダー (SCR-001) が「いつ空いているか」を答えるには、
   * 他団体の予約も施設・日時・団体名・ステータスまで見えている必要がある。
   *
   * ここに ViewDetail を足してはいけない。使用人数・備考・却下理由・作成者は
   * 自団体と事務局にだけ見せる項目である (COND-008)。
   *
   * NOTE: COND-008 の 3 段目 (Google Calendar 経由で誰でも見られる範囲) はここに無い。
   * ログインしていない相手には操作する人が居ないので、表の外で決める (authz.ts 参照)。
   */
  base: [ReservationAction.ViewSummary],
  byRole: {
    [MembershipRole.Admin]: [
      ReservationAction.ViewDetail,
      ReservationAction.CreateProvisional,
      ReservationAction.Withdraw,
      ReservationAction.Cancel,
      ReservationAction.Edit,
    ],
    [MembershipRole.Member]: [
      ReservationAction.ViewDetail,
      ReservationAction.CreateProvisional,
      ReservationAction.Withdraw,
      ReservationAction.Cancel,
      ReservationAction.Edit,
    ],
    /*
     * 事務局は所属していない団体でも予約を作れる (COND-009)。
     * 仮予約の申請だけでなく、承認済みの予約を直接作成（UC-008）することもできる。
     * 直接作成できるのは事務局だけである（団体メンバーが承認なしで予約を確定できてはいけないため）。
     *
     * 取り消し・キャンセルを入れていないのは、事務局にはそれ用の操作
     * (却下・事務局キャンセル) が別にあり、理由の入力を必須にしてあるため (COND-002)。
     * 事務局の人が自分の所属する団体の予約を取り消すときは、
     * メンバーとしての役割が和集合で効くので、そちらから取り消せる。
     *
     * 変更（Edit）も入れていない。事務局の変更は承認フローを経ない直接変更（UC-008）で、
     * 承認済みの予約を仮予約に戻さないなど規則が違うため、別の操作として用意する。
     * ここに Edit を足すと、事務局の変更が団体の変更（UC-005）の規則で通ってしまう。
     */
    [StaffRole]: [
      ReservationAction.ViewDetail,
      ReservationAction.CreateProvisional,
      ReservationAction.CreateDirect,
    ],
  },
};

/**
 * 予約まわりのエラーコード。
 *
 * 列挙子の名前は型名を繰り返さないが、文字列の値は変えないこと（ADR-004 決定 1）。
 * ログに出るのは値の方なので、変えると過去のログと突き合わせられなくなる。
 */
export const ReservationErrorCode = {
  /** 予約が存在しない */
  NotFound: "RESERVATION_NOT_FOUND",
  /**
   * 予約はあるが、見る権限が無いので見せない（COND-008）。
   *
   * 利用者には `NotFound` と同じ応答を返す。予約 ID を総当たりして存在を確かめられないようにするためで、
   * 団体の存在秘匿（COND-011）と同じ考え方である。ユースケースが `NotFound` に潰さずに正直に返すのは、
   * サーバーのログでは権限の無いアクセスとして残したいため。秘匿は画面の側
   * （`app/routes/_shared/reservation-error.server.ts`）が行う（ADR-004 決定 4）。
   *
   * NOTE: いまは権限表の `base` が概要の閲覧を全員に許しているので、ログイン済みの人には起きない。
   */
  NotVisible: "RESERVATION_NOT_VISIBLE",
  /** 予約を見られるが、その操作をする権限が無い */
  Forbidden: "RESERVATION_FORBIDDEN",
  /** 申請できない利用時間（刻み・利用可能時間・日またぎ・過去日時） */
  InvalidPeriod: "RESERVATION_INVALID_PERIOD",
  /** 利用時間以外の入力が不正（使用人数・備考・理由） */
  InvalidInput: "RESERVATION_INVALID_INPUT",
  /** 不正なステータス遷移（許可されていない状態からの操作） */
  InvalidTransition: "RESERVATION_INVALID_TRANSITION",
  /**
   * 同一施設・同一時間帯に承認済みの予約がある（COND-001）、
   * または同じ予約に対する別の操作が先に反映された
   */
  Conflict: "RESERVATION_CONFLICT",
  /** 申請元に選んだ団体が有効でない（COND-006） */
  GroupNotEligible: "RESERVATION_GROUP_NOT_ELIGIBLE",
  /** 申請先に選んだ施設・設備が見つからない、または無効になっている */
  FacilityNotAvailable: "RESERVATION_FACILITY_NOT_AVAILABLE",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type ReservationErrorCode = (typeof ReservationErrorCode)[keyof typeof ReservationErrorCode];

/**
 * 予約まわりのエラーコードの分類（ADR-004 決定 3）。
 *
 * HTTP の status とログのレベルは、この表から決まる。
 * `NotVisible` を `not_found` にしないこと。ログで総当たりを見つけるには
 * `forbidden`（warn）として残る必要がある。利用者への応答を 404 に揃えるのは画面の側の仕事である。
 */
export const reservationErrorKind: Record<ReservationErrorCode, ErrorKind> = {
  [ReservationErrorCode.NotFound]: ErrorKind.NotFound,
  [ReservationErrorCode.NotVisible]: ErrorKind.Forbidden,
  [ReservationErrorCode.Forbidden]: ErrorKind.Forbidden,
  [ReservationErrorCode.InvalidPeriod]: ErrorKind.InvalidInput,
  [ReservationErrorCode.InvalidInput]: ErrorKind.InvalidInput,
  // 操作は正しいが、予約がもうその状態にない。画面を開いた後に状態が変わったときに起きる
  [ReservationErrorCode.InvalidTransition]: ErrorKind.Conflict,
  [ReservationErrorCode.Conflict]: ErrorKind.Conflict,
  /*
   * 団体と施設は、存在して申請も許されているが、いまの状態（承認待ち・無効）が申請と両立しない。
   * 申請する権限は、この確認より前に確かめ終えているので forbidden ではなく、
   * 送られてきた ID も正しい形をしているので invalid_input でもない。
   */
  [ReservationErrorCode.GroupNotEligible]: ErrorKind.Conflict,
  [ReservationErrorCode.FacilityNotAvailable]: ErrorKind.Conflict,
  [ReservationErrorCode.DatabaseError]: ErrorKind.Internal,
};

/**
 * 失敗が、どの項目についてのものか（ADR-004 決定 6）。
 *
 * 画面の入力欄の名前ではなく、ドメインの語彙で書く。どの欄の下に出すかは、
 * 画面ごとにこの値から自分の欄を引く表を持って決める。
 *
 * 入力の誤り（invalid_input）に限らず、選び直せば通る失敗にも付ける。
 * 承認済みの予約との重なりなら時間帯を、団体が承認待ちなら団体を選び直せばよい。
 * どの欄の下に出るかで、何を直せばよいかが伝わる。
 */
export const ReservationField = {
  /** 申請元の団体 */
  Group: "reservation_group",
  /** 申請先の施設・設備 */
  Facility: "reservation_facility",
  /** 利用時間（日付・開始・終了をまとめて 1 つ） */
  Period: "reservation_period",
  /** 使用人数 */
  HeadCount: "reservation_head_count",
  /** 備考 */
  Note: "reservation_note",
  /** 却下・キャンセルの理由（COND-002） */
  StatusReason: "reservation_status_reason",
} as const;
export type ReservationField = (typeof ReservationField)[keyof typeof ReservationField];

export interface ReservationError extends BaseError {
  readonly code: ReservationErrorCode;
  /** どの項目についての失敗か。画面が欄を決めるのに使う */
  readonly field?: ReservationField;
}

/** 重複の確認（COND-001）に渡す時間帯。 */
export interface ReservationOverlapArgs {
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  /**
   * 重なりの相手から外す予約の ID。承認済みの予約の施設・日時を変えるとき（UC-005）に、変える予約自身を渡す。
   *
   * 外さないと、10:00〜12:00 の承認済みの予約を 11:00〜13:00 に動かすだけで、
   * 動かす前の自分自身と重なって必ず拒まれる。
   */
  readonly excludeReservationId?: string;
}

/** 予約ステータスを条件付きで更新するときの引数 */
export interface ApplyStatusTransitionArgs {
  readonly id: string;
  /**
   * 操作前の予約ステータス（読んだときの状態）。
   *
   * DB がこの状態のままでなければ 1 件も更新しない。同じ予約を 2 人が同時に
   * 操作したとき、あとから届いた方が相手の結果を上書きしてしまうのを防ぐ。
   */
  readonly expectedStatus: ReservationStatus;
  /**
   * 読んだときの更新日時。
   *
   * 仮予約は施設・日時を変えても仮予約のまま（UC-017）なので、ステータスだけでは
   * 読んでから書くまでに内容が変わったことに気づけない。気づけないと、事務局が見ていない
   * 施設・日時の予約を承認し、承認の通知には読んだときの古い日時が載ってしまう。
   * ステータスと両方を条件にする理由は ApplyContentEditArgs.expectedUpdatedAt と同じ。
   */
  readonly expectedUpdatedAt: Date;
  /** 更新後の予約ステータス */
  readonly status: ReservationStatus;
  readonly statusReason: string | null;
  readonly updatedAt: Date;
  /**
   * 承認（approve）のときだけ true。
   *
   * 同一施設・同一時間帯に承認済みの予約が無いこと（COND-001）を、
   * ステータスの更新と同じ 1 文の中で確かめる。
   */
  readonly requireNoApprovedOverlap: boolean;
}

/** 予約の内容を条件付きで変えるときの引数（UC-005 / UC-017） */
export interface ApplyContentEditArgs {
  readonly id: string;
  /**
   * 読んだときの予約ステータス。
   *
   * 更新日時（expectedUpdatedAt）と合わせて、DB が読んだときのままでなければ 1 件も更新しない。
   * これが無いと、読んでから書くまでの間に事務局が承認・却下した予約を、
   * 読んだときのステータスで書き戻してしまう（却下された予約が仮予約に戻る）。
   */
  readonly expectedStatus: ReservationStatus;
  /**
   * 読んだときの更新日時。
   *
   * ステータスだけでは、ステータスを動かさない別の変更（使用人数の変更など）が
   * 間に入ったことに気づけず、相手の変更を黙って上書きしてしまう。
   * 逆に更新日時だけにしないのは、ミリ秒単位で同じ時刻に入った状態変更を取りこぼさないため。
   */
  readonly expectedUpdatedAt: Date;
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly headCount: number;
  readonly note: string | null;
  /** 変更後の予約ステータス。承認済みの予約の施設・日時を変えたときだけ仮予約に変わる（COND-005） */
  readonly status: ReservationStatus;
  readonly updatedAt: Date;
  /**
   * 施設か日時を変えるときだけ true。
   *
   * 変更**後**の施設・時間帯に、ほかの承認済みの予約が無いこと（COND-001）を、
   * 更新と同じ 1 文の中で確かめる。
   */
  readonly requireNoApprovedOverlap: boolean;
}

/** 予約作成の結果。予約の INSERT は条件付きではないので applied は持たない */
export interface CreateReservationOutcome {
  /** この操作で outbox に積んだメールの ID。Queues への投入に使う */
  readonly enqueuedMailIds: readonly string[];
}

/** 条件付き更新の結果。更新できなかった (競合した) ときは ID の配列は空になる（ADR-002 決定 2.1） */
export interface ApplyStatusTransitionOutcome {
  readonly applied: boolean;
  /** この操作で outbox に積んだメールの ID。Queues への投入に使う */
  readonly enqueuedMailIds: readonly string[];
}

/** 内容の条件付き更新の結果。中身の意味はステータスの条件付き更新と同じ */
export type ApplyContentEditOutcome = ApplyStatusTransitionOutcome;

/**
 * 承認済みの予約の条件付き作成の結果。
 *
 * 重なる承認済みの予約が先に入っていて書き込まなかったときは applied が false になる。
 * 利用者に何を伝えるかはユースケースが決めるので、ここではエラーにしない（条件付き更新と同じ）。
 */
export interface CreateApprovedReservationOutcome {
  readonly applied: boolean;
}

export interface ReservationRepository {
  findById(id: string): ResultAsync<Reservation, ReservationError>;
  create(
    reservation: Reservation,
    mails: readonly MailDraft[],
  ): ResultAsync<CreateReservationOutcome, ReservationError>;
  /**
   * 承認済みの予約を直接作成する（UC-008）。
   *
   * 重なりの確認から書き込みまでの間に別の予約が承認されるのを防ぐため、
   * `INSERT ... SELECT ... WHERE NOT EXISTS (承認済みの重なり)` の 1 文で不可分に作成する。
   * 条件に合わず 0 件だったときは applied が false になる。
   */
  createApproved(
    reservation: Reservation,
  ): ResultAsync<CreateApprovedReservationOutcome, ReservationError>;
  /**
   * 同一施設・同一時間帯に**承認済み**の予約があるかを調べる（COND-001）。
   *
   * 仮予約は数えない。重複を禁じているのは承認済みの予約に対してだけで、
   * 仮予約どうしは重なってよい（事務局がどちらを承認するかを選ぶ）。
   *
   * 時間帯が重なるかどうかは「開始 < 相手の終わり」かつ「終わり > 相手の開始」で見る。
   * 終了時刻は予約に含まれないので、10:00 に終わる予約と 10:00 に始まる予約は重ならない。
   *
   * `excludeReservationId` を渡すと、その予約は重なりの相手に数えない。
   */
  existsApprovedOverlap(args: ReservationOverlapArgs): ResultAsync<boolean, ReservationError>;
  /**
   * 予約のステータス・理由・更新日時を条件付きで更新し、通知メールがあれば同じトランザクション（db.batch）で outbox に積む。
   *
   * @param args ステータス更新の条件と値
   * @param mails 同時に outbox に積むメール（承認時の通知など）。不可分に書く手段として同じメソッドで受け取る。
   * @returns 更新結果と積まれたメール ID の配列。条件に合わず 0 件だったら applied: false（競合）。
   */
  applyStatusTransition(
    args: ApplyStatusTransitionArgs,
    mails: readonly MailDraft[],
  ): ResultAsync<ApplyStatusTransitionOutcome, ReservationError>;
  /**
   * 予約の内容（施設・日時・使用人数・備考）とステータス・更新日時を条件付きで更新し、
   * 通知メールがあれば同じトランザクション（db.batch）で outbox に積む（UC-005 / UC-017）。
   *
   * @param args 更新の条件と値
   * @param mails 同時に outbox に積むメール（EVT-004 / EVT-012）
   * @returns 更新結果と積まれたメール ID の配列。条件に合わず 0 件だったら applied: false（競合）。
   */
  applyContentEdit(
    args: ApplyContentEditArgs,
    mails: readonly MailDraft[],
  ): ResultAsync<ApplyContentEditOutcome, ReservationError>;
}

/**
 * 予約時間の刻み（分）。開始・終了ともこの倍数にそろえる。
 *
 * 空き状況カレンダー（SCR-001）の枠は 1 時間単位だが、申請はここまで細かく選べる。
 * 1 時間単位に合わせてしまうと「10:30 から 1 時間だけ使いたい」が表せず、
 * 実際には空いている 30 分を誰も使えないまま押さえることになる。
 *
 * INFO-002（施設/設備）に刻みの属性が無いので、全施設で同じ値にしている。
 * 施設ごとに変えたくなったら、まず情報モデルに属性を足すこと。
 */
export const RESERVATION_STEP_MINUTES = 30;

/** 予約の利用時間。開始時刻を含み、終了時刻は含まない。 */
export interface ReservationPeriod {
  readonly startAt: Date;
  readonly endAt: Date;
}

/**
 * 使用人数の下限（INFO-001: 使用人数は必須）。
 *
 * 上限は決めていない。INFO-002（施設/設備）に定員の属性が無いので、
 * 上限を書くとすれば情報モデルに無い数字を画面の中だけで決めることになる。
 */
export const RESERVATION_MIN_HEAD_COUNT = 1;

/**
 * 備考の最大文字数。
 *
 * INFO-001 に長さの定めは無いが、入力欄に上限が無いと、
 * 事務局が予約一覧で内容を見比べられない量を貼り付けられてしまう。
 */
export const RESERVATION_NOTE_MAX_LENGTH = 500;

/** 利用時間のほかに、申請の中身として確かめること。 */
export interface ReservationDetail {
  readonly headCount: number;
  readonly note: string | null;
}

/** これから作ろうとしている予約の中身。 */
export type ReservationDraft = ReservationPeriod & ReservationDetail;

/**
 * 空き状況カレンダー（SCR-001）に描くステータス。
 *
 * 終了した予約（取り消し済み・却下済み・キャンセル済み・事務局キャンセル済み）は描かない。
 * これらを描くと、実際には空いている時間帯が埋まっているように見えてしまい、
 * 「空き状況を確認する」（UC-001）という画面の目的が果たせなくなるため。
 *
 * COND-008 が「ステータスを問わず表示する」と定めているのは
 * **どこまでの項目を開示するか**の話であり、どの予約を描くかの話ではない。
 * 終了した予約は予約一覧（SCR-003）と予約詳細（SCR-005）で確認できる。
 */
export const calendarVisibleStatuses = [
  ReservationStatus.Provisional,
  ReservationStatus.Approved,
] as const;
