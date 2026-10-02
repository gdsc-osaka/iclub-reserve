import type { ResultAsync } from "neverthrow";
import type { GroupError } from "../group";
import type { MailDraft } from "../mail/mail-outbox";
import type { MembershipRole } from "../membership";

/** 招待の状態。もとが Better Auth の綴りで、既存データと既定値がこの値のため踏襲している */
export const InvitationStatus = {
  Pending: "pending",
  Accepted: "accepted",
  Rejected: "rejected",
  /** 取り消し済み。もとが Better Auth の綴りで、既存データと既定値がこの値のため踏襲している */
  Canceled: "canceled",
} as const;
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];

/** 文字列がこのアプリの招待状態かどうかを判定する */
export const isInvitationStatus = (value: string): value is InvitationStatus =>
  (Object.values(InvitationStatus) as readonly string[]).includes(value);

/**
 * 招待の有効期限（時間）。
 *
 * 運用で決めた値。承諾されずに残り続ける招待を減らすため。
 * 変えるときはメール本文の案内も一緒に見直すこと。
 */
export const INVITATION_EXPIRES_IN_HOURS = 48;

/**
 * 招待が作成された日時から有効期限の日時を計算して返す純粋関数。
 *
 * ミリ秒の計算はここ 1 か所に閉じ、引数として渡された Date オブジェクトは変更せず
 * 新しい Date オブジェクトを返す。
 */
export const invitationExpiresAt = (now: Date): Date =>
  new Date(now.getTime() + INVITATION_EXPIRES_IN_HOURS * 60 * 60 * 1000);

/**
 * 招待を承諾するための画面パスを生成する純粋関数。
 *
 * 【設計上の注意点】
 * - この URL の画面（SCR-016 / UC-022）は `app/routes/invitations/$invitationId/route.tsx` で実装されている。
 * - 招待の ID そのものが承諾の合図になるので、管理者・事務局以外に見せてはいけないこと。
 *   ID は createId()（CUID2）で作るので当て推量はできない。
 */
export const invitationAcceptPath = (invitationId: string): string =>
  `/invitations/${invitationId}`;

/**
 * 招待を表すドメインモデル。
 */
export interface Invitation {
  readonly id: string;
  readonly groupId: string;
  readonly email: string;
  readonly role: MembershipRole;
  readonly status: InvitationStatus;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly inviterUserId: string;
}

/**
 * 招待の新規作成に必要な値。
 */
export interface CreateInvitationInput {
  readonly id: string;
  readonly groupId: string;
  /**
   * 検証済みのメールアドレス（小文字に正規化済み）。
   *
   * 検証済みの値だけが渡ってくる。検証はユースケースの担当で、リポジトリでは確かめ直さない。
   */
  readonly email: string;
  /**
   * 検証済みの役割（COND-007 により単一）。
   *
   * 検証済みの値だけが渡ってくる。検証はユースケースの担当で、リポジトリでは確かめ直さない。
   */
  readonly role: MembershipRole;
  readonly inviterUserId: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/**
 * 招待の承諾に必要な値。
 *
 * 招待 ID だけでなく宛先と基準時刻まで渡すのは、承諾できるかどうかの判定を
 * UPDATE の WHERE に畳み込むため（事前の SELECT を無くし、競合を原理的に起こさない）。
 */
export interface AcceptInvitationInput {
  readonly invitationId: string;
  /**
   * 承諾しようとしている人のメールアドレス（`normalizeInvitationEmail` を通したもの）。
   *
   * 検証済みの値だけが渡ってくる。検証はユースケースの担当で、リポジトリでは確かめ直さない。
   */
  readonly email: string;
  /** 承諾する人の `user.id`。作成する `group_member` 行の持ち主になる */
  readonly userId: string;
  /** 作成する `group_member` 行の ID。生成はユースケースの担当 */
  readonly membershipId: string;
  /** 有効期限を判定する基準時刻 */
  readonly now: Date;
}

/** 招待の辞退に必要な値。判定の条件は承諾と同じなので、作る行が無いぶんだけ少ない */
export interface RejectInvitationInput {
  readonly invitationId: string;
  /** 辞退しようとしている人のメールアドレス（`normalizeInvitationEmail` を通したもの） */
  readonly email: string;
  readonly now: Date;
}

/** 招待作成の実行結果 */
export interface CreateInvitationOutcome {
  readonly enqueuedMailIds: readonly string[];
}

/**
 * 招待の永続化層に対する窓口（ポート）。
 *
 * 【エラー型に GroupError を直接使用する理由】
 * このポートは MembershipError のような専用のエラー型を持たず、直接 GroupError を返す。
 * 招待は団体管理のユースケースからしか触らないので、専用のエラー型を作って
 * ユースケース側で毎回 GroupError に詰め替えると、意味の無い変換が 1 段増えるだけになる。
 * GroupRepository が GroupError を返しているのと同じ形である。
 * （MembershipRepository が専用の型を持っているのは、予約のユースケースからも使われ、
 * そちらでは ReservationError に変換する必要があるため。招待にはその事情が無い。）
 */
export interface InvitationRepository {
  /**
   * その団体・その宛先に対する承諾待ち（pending）の招待を 1 件返す。無ければ ok(null)。
   *
   * 期限切れかどうかはここでは見ない。「期限が切れていたら送り直せる」というのは運用の方針であり、
   * 基準となる「いま」を持っているのはユースケースだから。
   * 所属していないことをエラーにしない MembershipRepository.findByGroupAndUser と同じ考え方で、
   * 「見つからない」は異常ではないので err にしない。
   */
  findPendingByGroupAndEmail(
    groupId: string,
    email: string,
  ): ResultAsync<Invitation | null, GroupError>;

  /** 招待を作り、同じ batch で通知メールを outbox に積む（ADR-002 決定 3） */
  create(
    input: CreateInvitationInput,
    mails: readonly MailDraft[],
  ): ResultAsync<CreateInvitationOutcome, GroupError>;

  /**
   * 承諾待ちの招待を取り消し、取り消した件数を返す。
   *
   * 0 件は「対象がその団体に無かった」ということであり、DB アクセス自体の異常ではない
   * （画面を開いたあとに別の管理者が先に取り消した場合など）。
   * これをどう扱うかは呼び出し側（ユースケース）が決める。
   */
  cancel(groupId: string, invitationId: string): ResultAsync<number, GroupError>;

  /**
   * 招待を 1 件引く。無ければ ok(null)。
   *
   * 承諾できる状態かどうか（期限・状態・宛先）はここでは見ない。
   * それを判定するための材料を返すのがこのメソッドの役目で、
   * 判定の基準となる「いま」とログイン中の人を知っているのはユースケースだから。
   *
   * 団体 ID で絞らないのは、承諾画面を開く人がどの団体の招待かをまだ知らないため。
   * 招待 ID（CUID2）そのものが「その招待を提示できる」という合図になっている。
   */
  findById(invitationId: string): ResultAsync<Invitation | null, GroupError>;

  /**
   * 招待を承諾し、承諾できた場合はその団体の ID を返す。できなければ null。
   *
   * 「承諾できる招待か」の判定（承諾待ち・期限内・宛先が本人）は UPDATE の WHERE に畳み込む。
   * null は「対象の招待が無かった」ということであり、DB アクセス自体の異常ではない
   * （画面を開いたあとに管理者が取り消した、二重に送信した、など）。
   * これをどう扱うかは呼び出し側（ユースケース）が決める。
   *
   * 団体 ID を返すのは、承諾後にその団体の画面へ送るため。
   * 別に引き直さずに済むよう、UPDATE の RETURNING で受け取る。
   */
  accept(input: AcceptInvitationInput): ResultAsync<string | null, GroupError>;

  /**
   * 招待を辞退し、辞退できた行数を返す。
   *
   * 件数の考え方は `cancel` と同じ。判定の条件は `accept` とそろえる
   * （画面に出ていない招待を、古いフォームの再送信で辞退できてしまわないようにするため）。
   */
  reject(input: RejectInvitationInput): ResultAsync<number, GroupError>;
}
