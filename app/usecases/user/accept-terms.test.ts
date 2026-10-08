import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it, vi } from "vitest";

import { TERMS_OF_SERVICE } from "~/domain/authn/terms-of-service";
import { UserErrorCode, type TermsAcceptanceRepository, type UserError } from "~/domain/user";
import { acceptTermsUseCase } from "./accept-terms";

const userId = "usr_user_1";
const now = new Date("2026-10-08T03:00:00Z");

/** 記録の結果を決めた偽物の Repository を作る */
const repositoryReturning = (
  result: ReturnType<TermsAcceptanceRepository["recordAcceptance"]>,
): TermsAcceptanceRepository => ({
  recordAcceptance: vi.fn(() => result),
});

describe("acceptTermsUseCase", () => {
  it("同意の印があり、今の版なら、その版とサーバーの時刻で記録する", async () => {
    const termsAcceptanceRepository = repositoryReturning(okAsync(null));

    const result = await acceptTermsUseCase(
      { termsAcceptanceRepository },
      { userId, agreed: "on", termsVersion: TERMS_OF_SERVICE.version, now },
    );

    expect(result.isOk()).toBe(true);
    expect(termsAcceptanceRepository.recordAcceptance).toHaveBeenCalledWith(
      userId,
      TERMS_OF_SERVICE.version,
      now,
    );
  });

  it("同意の印が無ければ、記録せずに TermsNotAgreed で止める", async () => {
    const termsAcceptanceRepository = repositoryReturning(okAsync(null));

    const result = await acceptTermsUseCase(
      { termsAcceptanceRepository },
      { userId, agreed: null, termsVersion: TERMS_OF_SERVICE.version, now },
    );

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: UserErrorCode.TermsNotAgreed,
      userMessage: expect.stringContaining("同意する"),
    });
    expect(termsAcceptanceRepository.recordAcceptance).not.toHaveBeenCalled();
  });

  it("画面を開いた後に改定され、古い版が届いたら、記録せずに TermsOutdated で止める", async () => {
    const termsAcceptanceRepository = repositoryReturning(okAsync(null));

    const result = await acceptTermsUseCase(
      { termsAcceptanceRepository },
      { userId, agreed: "on", termsVersion: "2000-01-01", now },
    );

    expect(result._unsafeUnwrapErr().code).toBe(UserErrorCode.TermsOutdated);
    expect(termsAcceptanceRepository.recordAcceptance).not.toHaveBeenCalled();
  });

  it("記録に失敗したら、その失敗をそのまま返す", async () => {
    const dbError: UserError = {
      code: UserErrorCode.DatabaseError,
      message: "D1 に届かなかった。",
    };
    const termsAcceptanceRepository = repositoryReturning(errAsync(dbError));

    const result = await acceptTermsUseCase(
      { termsAcceptanceRepository },
      { userId, agreed: "on", termsVersion: TERMS_OF_SERVICE.version, now },
    );

    expect(result._unsafeUnwrapErr()).toBe(dbError);
  });
});
