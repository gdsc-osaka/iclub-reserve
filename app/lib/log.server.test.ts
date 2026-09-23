import { afterEach, describe, expect, it, vi } from "vitest";

import { logFailure, type FailureLog } from "./log.server";

const baseLog: FailureLog = {
  level: "error",
  where: "groups.detail.loader",
  code: "DATABASE_ERROR",
  kind: "internal",
  userId: "usr_01",
  message: "団体テーブルを読み書きできなかった。",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logFailure", () => {
  it.each(["info", "warn", "error"] as const)(
    "level が %s のときは console.%s に出し、項目にも level を入れる",
    (level) => {
      const spy = vi.spyOn(console, level).mockImplementation(() => {});

      logFailure({ ...baseLog, level });

      // console のメソッドの違いで絞り込めるかは Workers Logs の説明に無いため、項目にも入れている
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ level }));
    },
  );

  it("文字列ではなく、項目を持ったオブジェクト 1 つで出す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logFailure(baseLog);

    // Workers Logs がオブジェクトの項目を索引するので、コードごと・利用者ごとに数えられる
    expect(spy).toHaveBeenCalledWith({
      level: "error",
      where: "groups.detail.loader",
      code: "DATABASE_ERROR",
      kind: "internal",
      userId: "usr_01",
      message: "団体テーブルを読み書きできなかった。",
    });
  });

  it("cause が無いときは、cause の項目を出さない", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    logFailure({ ...baseLog, cause: undefined });

    expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("cause");
  });

  it("cause の Error は、JSON にしても name・message・stack が残る形に直す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("D1_ERROR: no such table");

    logFailure({ ...baseLog, cause: error });

    const logged = spy.mock.calls[0]?.[0];
    // Error のままだと、これらは列挙されないプロパティなので JSON にすると消える
    const roundTripped = JSON.parse(JSON.stringify(logged));
    expect(roundTripped.cause).toEqual({
      name: "Error",
      message: "D1_ERROR: no such table",
      stack: error.stack,
    });
  });

  it("ドメインのエラーに包まれた Error も、たどって直す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const dbError = new Error("connection reset", { cause: new Error("socket closed") });

    logFailure({
      ...baseLog,
      // 所属の DB エラーを団体の DB エラーに包み直したときの形
      cause: { code: "DATABASE_ERROR", message: "所属を取得できなかった。", cause: dbError },
    });

    const roundTripped = JSON.parse(JSON.stringify(spy.mock.calls[0]?.[0]));
    expect(roundTripped.cause.code).toBe("DATABASE_ERROR");
    expect(roundTripped.cause.cause.message).toBe("connection reset");
    expect(roundTripped.cause.cause.stack).toBe(dbError.stack);
    expect(roundTripped.cause.cause.cause.message).toBe("socket closed");
  });

  it("循環した cause でも止まらずに出す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const looped: { message: string; cause?: unknown } = { message: "自分を指す" };
    looped.cause = looped;

    logFailure({ ...baseLog, cause: looped });

    expect(() => JSON.stringify(spy.mock.calls[0]?.[0])).not.toThrow();
  });
});
