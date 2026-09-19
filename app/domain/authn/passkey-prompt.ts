/**
 * 「パスキーを登録しませんか」と勧めてよいかどうかの判定。
 *
 * 勧める画面は、ログインのたびに無条件で出すわけにはいかない。
 * かといって一度断られたきり二度と出さないと、
 * 「今は忙しいから後で」と思った人が登録する機会を失ってしまう。
 *
 * そこで「あとで」を選ばれるたびに次に勧めるまでの間隔を延ばし、
 * 何度も断る人には最終的に出さないようにする。
 */

/**
 * 「あとで」を選ばれた回数ごとに、次に勧めるまで空ける日数。
 *
 * 1 回目の「あとで」のあとは 14 日、2 回目のあとは 60 日空ける。
 * 3 回目以降（この一覧の長さを超えた回数）は、もう勧めない。
 * 断り続けている人に出し続けても登録にはつながらず、邪魔なだけのため。
 */
const COOLDOWN_DAYS: readonly number[] = [14, 60];

/** 1 日のミリ秒数。日時の差を日数と比べるために使う。 */
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * 「あとで」を選ばれたことの記録。
 *
 * パスキーは端末ごとに作るものなので、この記録もサーバーではなく端末側に持つ。
 * 保存の方法は `app/lib/auth/passkey-prompt-storage.ts` を参照。
 */
export type PasskeyPromptState = {
  /** 「あとで」を選ばれた回数。1 以上。 */
  readonly dismissedCount: number;
  /** 最後に「あとで」を選ばれた日時（エポックミリ秒）。 */
  readonly dismissedAt: number;
};

/**
 * 保存されていた文字列を記録に戻す。
 *
 * 端末に保存した値は利用者が書き換えられるうえ、
 * 昔のバージョンが書いた別の形が残っていることもある。
 * 少しでも期待と違う形なら「記録なし」（null）として扱い、
 * `shouldSuggestPasskey` には「まだ一度も断られていない」と見せる。
 *
 * @param raw 端末に保存されていた文字列。何もなければ null
 */
export const parsePasskeyPromptState = (raw: string | null): PasskeyPromptState | null => {
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const { dismissedCount, dismissedAt } = parsed as Partial<PasskeyPromptState>;

  // 回数が 1 未満の記録は「断られていない」のと同じなので、記録なしとして扱う。
  if (typeof dismissedCount !== "number" || !Number.isInteger(dismissedCount)) return null;
  if (dismissedCount < 1) return null;
  if (typeof dismissedAt !== "number" || !Number.isFinite(dismissedAt)) return null;

  return { dismissedCount, dismissedAt };
};

/**
 * 「あとで」を選ばれたときの、新しい記録を作る。
 *
 * @param state これまでの記録。初めてならnull
 * @param now 今の日時（エポックミリ秒）
 */
export const recordDismissal = (
  state: PasskeyPromptState | null,
  now: number,
): PasskeyPromptState => ({
  dismissedCount: (state?.dismissedCount ?? 0) + 1,
  dismissedAt: now,
});

/**
 * パスキーの登録を勧めてよいかどうか。
 *
 * ここで判断するのは「勧める頃合いか」だけ。
 * 「この端末にパスキーを保存できるか」（`usePasskeySupport`）と
 * 「すでにパスキーを持っていないか」（サーバー側の確認）は別に確かめる。
 *
 * @param state 端末に残っている「あとで」の記録。なければ null
 * @param now 今の日時（エポックミリ秒）
 */
export const shouldSuggestPasskey = (state: PasskeyPromptState | null, now: number): boolean => {
  // 一度も断られていなければ勧める。
  if (state === null) return true;

  const cooldownDays = COOLDOWN_DAYS[state.dismissedCount - 1];
  // 用意した間隔を使い切るまで断られたら、もう勧めない。
  if (cooldownDays === undefined) return false;

  // 端末の時計が進んだ状態で記録されると、時計を直したあと
  // 二度と勧められなくなってしまう。未来の日時は壊れた記録とみなす。
  if (state.dismissedAt > now) return true;

  return now - state.dismissedAt >= cooldownDays * DAY_IN_MS;
};
