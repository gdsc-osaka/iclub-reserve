/**
 * 利用規約への同意（REQ-033）の書き込みを、本物の D1 に対して実行して確かめるテスト。
 *
 * ユースケースのテストは Repository を偽物に差し替えるので、更新文の条件の誤りは素通りする。
 * ここでは、本人の行だけに版と日時が入ること、同じ版の再送信では最初の日時が残ること、
 * 無いユーザーを NotFound として返すことを押さえる。
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { user } from "~/db/schema";
import { UserErrorCode } from "~/domain/user";
import { useD1TestDb } from "../d1-test-db";
import { createTermsAcceptanceRepository } from "./terms-acceptance-repo";

const ACCEPTED_AT = new Date("2026-10-08T03:00:00Z");

const testDb = useD1TestDb();

beforeEach(async () => {
  await testDb.seed(
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_taro",
      "",
      "taro@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
    [
      `INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at, is_staff) VALUES (?,?,?,?,?,?,?)`,
      "usr_hanako",
      "花子",
      "hanako@ecs.osaka-u.ac.jp",
      1,
      0,
      0,
      0,
    ],
  );
});

const readTerms = async (userId: string) => {
  const [row] = await testDb.db
    .select({ version: user.terms_version, acceptedAt: user.terms_accepted_at })
    .from(user)
    .where(eq(user.id, userId));
  return row;
};

describe("createTermsAcceptanceRepository.recordAcceptance", () => {
  it("本人の行に、同意した版と日時を書く。ほかの人の行は変えない", async () => {
    const result = await createTermsAcceptanceRepository(testDb.db).recordAcceptance(
      "usr_taro",
      "2022-04-01",
      ACCEPTED_AT,
    );

    expect(result.isOk()).toBe(true);
    expect(await readTerms("usr_taro")).toEqual({
      version: "2022-04-01",
      acceptedAt: ACCEPTED_AT,
    });
    expect(await readTerms("usr_hanako")).toEqual({ version: null, acceptedAt: null });
  });

  it("改定後にもう一度同意すると、新しい版と日時で上書きする", async () => {
    const repository = createTermsAcceptanceRepository(testDb.db);
    const later = new Date("2027-04-01T00:00:00Z");

    await repository.recordAcceptance("usr_taro", "2022-04-01", ACCEPTED_AT);
    await repository.recordAcceptance("usr_taro", "2027-04-01", later);

    expect(await readTerms("usr_taro")).toEqual({ version: "2027-04-01", acceptedAt: later });
  });

  it("同じ版にもう一度同意しても、最初に同意した日時を残す", async () => {
    const repository = createTermsAcceptanceRepository(testDb.db);

    await repository.recordAcceptance("usr_taro", "2022-04-01", ACCEPTED_AT);
    const result = await repository.recordAcceptance(
      "usr_taro",
      "2022-04-01",
      new Date("2026-10-09T00:00:00Z"),
    );

    expect(result.isOk()).toBe(true);
    expect(await readTerms("usr_taro")).toEqual({
      version: "2022-04-01",
      acceptedAt: ACCEPTED_AT,
    });
  });

  it("ユーザーが無ければ NotFound を返す", async () => {
    const result = await createTermsAcceptanceRepository(testDb.db).recordAcceptance(
      "usr_missing",
      "2022-04-01",
      ACCEPTED_AT,
    );

    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.NotFound);
  });
});
