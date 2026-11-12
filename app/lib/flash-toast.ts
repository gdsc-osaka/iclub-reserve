/** action が成功したときに出すトーストの中身（root の loader から画面に渡す） */
export type FlashToast = {
  /** 1 回の知らせごとに変わる値。同じ知らせを 2 回出さないために使う */
  readonly id: string;
  readonly title: string;
  readonly description?: string;
};

/** action が書き込む中身。id は読むときに付ける */
export type FlashToastInput = Omit<FlashToast, "id">;
