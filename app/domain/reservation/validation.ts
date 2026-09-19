import { err, ok, type Result } from "neverthrow";
/*
 * ドメインから `~/lib` を参照しているのはここだけ。
 * `app/lib/date.ts` は何も import しない純粋な日付計算なので、
 * 参照しても外側（DB・画面・通信）への依存は増えない。
 * 日本時間での判定を自前で書き直すと、同じ計算が 2 か所に散らばる。
 */
import { isSameTokyoDay, tokyoMinutesOfDay } from "~/lib/date";
import { FACILITY_CLOSE_HOUR, FACILITY_OPEN_HOUR } from "../facility";
import {
  RESERVATION_MIN_HEAD_COUNT,
  RESERVATION_NOTE_MAX_LENGTH,
  RESERVATION_STEP_MINUTES,
  ReservationErrorCode,
  ReservationTransition,
  type ReservationDraft,
  type ReservationError,
  type ReservationPeriod,
} from ".";

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
 * 操作理由の妥当性を検証する（COND-002）。
 *
 * 事務局による却下（reject）およびキャンセル（staffCancel）は理由入力が必須（空文字・空白のみも拒否）。
 * 団体による取り消し（withdraw）およびキャンセル（cancel）は任意。
 * 承認（approve）は理由不要（null を返す）。
 */
export const validateTransitionReason = (
  transition: ReservationTransition,
  reason?: string | null,
): Result<string | null, ReservationError> => {
  const trimmed = reason?.trim() ?? "";

  switch (transition) {
    case ReservationTransition.Reject:
      if (trimmed === "") {
        return err({
          code: ReservationErrorCode.ReservationInvalidInput,
          message: "却下理由を入力してください。",
        });
      }
      return ok(trimmed);

    case ReservationTransition.StaffCancel:
      if (trimmed === "") {
        return err({
          code: ReservationErrorCode.ReservationInvalidInput,
          message: "キャンセル理由を入力してください。",
        });
      }
      return ok(trimmed);

    case ReservationTransition.Withdraw:
    case ReservationTransition.Cancel:
      return ok(trimmed !== "" ? trimmed : null);

    case ReservationTransition.Approve:
      return ok(null);
  }
};
