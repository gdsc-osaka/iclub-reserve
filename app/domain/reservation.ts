import { err, ok, type Result, type ResultAsync } from "neverthrow";
/*
 * ドメインから `~/lib` を参照しているのはここだけ。
 * `app/lib/date.ts` は何も import しない純粋な日付計算なので、
 * 参照しても外側（DB・画面・通信）への依存は増えない。
 * 日本時間での判定を自前で書き直すと、同じ計算が 2 か所に散らばる。
 */
import { isSameTokyoDay, tokyoMinutesOfDay } from "~/lib/date";
import type { PermissionTable } from "./authz";
import { FACILITY_CLOSE_HOUR, FACILITY_OPEN_HOUR } from "./facility";
import { MembershipRole } from "./membership";

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
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const ReservationAction = {
  CreateProvisional: "create_provisional",
} as const;
export type ReservationAction = (typeof ReservationAction)[keyof typeof ReservationAction];

export const reservationPermissions: PermissionTable<MembershipRole, ReservationAction> = {
  [MembershipRole.Admin]: [ReservationAction.CreateProvisional],
  [MembershipRole.Member]: [ReservationAction.CreateProvisional],
};

export const ReservationErrorCode = {
  ReservationNotFound: "RESERVATION_NOT_FOUND",
  ReservationForbidden: "RESERVATION_FORBIDDEN",
  /** 申請できない利用時間（刻み・利用可能時間・日またぎ・過去日時） */
  ReservationInvalidPeriod: "RESERVATION_INVALID_PERIOD",
  /** 利用時間以外の入力が不正（使用人数・備考） */
  ReservationInvalidInput: "RESERVATION_INVALID_INPUT",
  /** 同一施設・同一時間帯に承認済みの予約がある（COND-001） */
  ReservationConflict: "RESERVATION_CONFLICT",
  /** 申請元に選んだ団体が有効でない（COND-006） */
  ReservationGroupNotEligible: "RESERVATION_GROUP_NOT_ELIGIBLE",
  DatabaseError: "DATABASE_ERROR",
} as const;
export type ReservationErrorCode = (typeof ReservationErrorCode)[keyof typeof ReservationErrorCode];

export interface ReservationError {
  readonly code: ReservationErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

/** 重複の確認（COND-001）に渡す時間帯。 */
export interface ReservationOverlapArgs {
  readonly facilityId: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

export interface ReservationRepository {
  findById(id: string): ResultAsync<Reservation, ReservationError>;
  create(reservation: Reservation): ResultAsync<null, ReservationError>;
  /**
   * 同一施設・同一時間帯に**承認済み**の予約があるかを調べる（COND-001）。
   *
   * 仮予約は数えない。重複を禁じているのは承認済みの予約に対してだけで、
   * 仮予約どうしは重なってよい（事務局がどちらを承認するかを選ぶ）。
   *
   * 時間帯が重なるかどうかは「開始 < 相手の終わり」かつ「終わり > 相手の開始」で見る。
   * 終了時刻は予約に含まれないので、10:00 に終わる予約と 10:00 に始まる予約は重ならない。
   */
  existsApprovedOverlap(args: ReservationOverlapArgs): ResultAsync<boolean, ReservationError>;
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

/** 利用可能時間を「0 時から何分」で表したもの。判定はこの単位で行う */
const OPEN_MINUTES = FACILITY_OPEN_HOUR * 60;
const CLOSE_MINUTES = FACILITY_CLOSE_HOUR * 60;

const invalidPeriod = (message: string): ReservationError => ({
  code: ReservationErrorCode.ReservationInvalidPeriod,
  message,
});

/**
 * 申請できる利用時間かどうかを確かめる（REQ-002）。
 *
 * 画面（SCR-002）は選べる時刻を選択肢として出しているが、それとは別にここでも確かめる。
 * フォームの値は POST を組み立てれば自由に送れるので、
 * 画面の選択肢だけに頼ると、利用可能時間の外や過去の日時で予約が作れてしまう。
 *
 * 判定するのは「予約そのものが成り立つか」だけで、他の予約との重なり（COND-001）や
 * 申請元の団体（COND-006）は見ない。あちらは DB を引かないと分からないので、
 * ユースケース層で確かめている。
 *
 * @param now 「過去かどうか」の基準になる現在時刻。呼び出し側から渡すことで、
 *   同じ入力なら必ず同じ結果になるようにしている（テストのため）。
 */
export const validateReservationPeriod = (
  period: ReservationPeriod,
  now: Date,
): Result<ReservationPeriod, ReservationError> => {
  if (period.endAt <= period.startAt) {
    return err(invalidPeriod("終了時刻は開始時刻より後にしてください。"));
  }

  /*
   * 日をまたぐ予約を先に弾いておく。ここから下は「0 時から何分」で判定するので、
   * 開始と終了が別の日だと 20:00〜翌 10:00 が「1200 分〜600 分」になり、
   * 逆向きの時間帯として通ってしまう。
   */
  if (!isSameTokyoDay(period.startAt, period.endAt)) {
    return err(invalidPeriod("日をまたぐ予約はできません。日ごとに分けて申請してください。"));
  }

  const startMinutes = tokyoMinutesOfDay(period.startAt);
  const endMinutes = tokyoMinutesOfDay(period.endAt);

  if (
    startMinutes % RESERVATION_STEP_MINUTES !== 0 ||
    endMinutes % RESERVATION_STEP_MINUTES !== 0
  ) {
    return err(
      invalidPeriod(`開始時刻と終了時刻は ${RESERVATION_STEP_MINUTES} 分単位で選んでください。`),
    );
  }

  if (startMinutes < OPEN_MINUTES || endMinutes > CLOSE_MINUTES) {
    return err(
      invalidPeriod(
        `利用できるのは ${FACILITY_OPEN_HOUR}:00〜${FACILITY_CLOSE_HOUR}:00 の間です。`,
      ),
    );
  }

  if (period.startAt < now) {
    return err(invalidPeriod("過ぎた日時には申請できません。"));
  }

  return ok(period);
};

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
 * 申請の中身として成り立つかを確かめる（REQ-002 / INFO-001）。
 *
 * 画面（SCR-002）にも `min` や `maxlength` を付けているが、それとは別にここでも確かめる。
 * どちらもブラウザの都合で外せるので、画面の指定だけに頼ると
 * 0 人の予約や、際限なく長い備考が保存できてしまう。
 */
export const validateReservationDraft = (
  draft: ReservationDraft,
  now: Date,
): Result<ReservationDraft, ReservationError> =>
  validateReservationPeriod(draft, now).andThen(() => {
    if (!Number.isSafeInteger(draft.headCount) || draft.headCount < RESERVATION_MIN_HEAD_COUNT) {
      return err({
        code: ReservationErrorCode.ReservationInvalidInput,
        message: `使用人数は ${RESERVATION_MIN_HEAD_COUNT} 以上の整数で入力してください。`,
      } satisfies ReservationError);
    }

    if (draft.note !== null && draft.note.length > RESERVATION_NOTE_MAX_LENGTH) {
      return err({
        code: ReservationErrorCode.ReservationInvalidInput,
        message: `備考は ${RESERVATION_NOTE_MAX_LENGTH} 文字以内で入力してください。`,
      } satisfies ReservationError);
    }

    return ok(draft);
  });

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
