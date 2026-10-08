import { err, ok, okAsync, safeTry, type Result, type ResultAsync } from "neverthrow";

import { TERMS_OF_SERVICE } from "~/domain/authn/terms-of-service";
import { UserErrorCode, type TermsAcceptanceRepository, type UserError } from "~/domain/user";

export interface AcceptTermsDeps {
  readonly termsAcceptanceRepository: TermsAcceptanceRepository;
}

export interface AcceptTermsArgs {
  readonly userId: string;
  /** フォームから届いた、同意のチェックボックスの値。印を付けていれば "on" */
  readonly agreed: unknown;
  /** フォームから届いた、画面に出していた規約の版 */
  readonly termsVersion: unknown;
  readonly now: Date;
}

/**
 * 同意のフォームを検証し、同意した版を返す。
 *
 * 版も送らせているのは、画面を開いたまま規約が改定された場合に、
 * 読んでいない新しい版へ同意したことにしないため。
 */
const validateTermsAgreement = (
  args: Pick<AcceptTermsArgs, "agreed" | "termsVersion">,
): Result<string, UserError> => {
  if (args.agreed !== "on") {
    return err({
      code: UserErrorCode.TermsNotAgreed,
      message: "利用規約への同意の印が付いていない。",
      userMessage: "利用規約をご確認のうえ、「同意する」に印を付けてください。",
    });
  }

  if (args.termsVersion !== TERMS_OF_SERVICE.version) {
    return err({
      code: UserErrorCode.TermsOutdated,
      message: `今の版（${TERMS_OF_SERVICE.version}）ではない規約に同意しようとした。`,
      userMessage: "利用規約が改定されました。画面を読み込み直して、改定後の規約をご確認ください。",
    });
  }

  return ok(args.termsVersion);
};

/**
 * 利用規約に同意するユースケース（UC-019 / REQ-033）。
 *
 * 初回セットアップ画面（SCR-014）で、規約に同意した人の同意を記録する。
 * 同意しないと本登録が済まず、アプリの画面を開けない（`isOnboardingCompleted`）。
 *
 * 同意の日時はサーバーの時刻で決める。ブラウザから届いた日時を記録にすると、偽れてしまうため。
 */
export const acceptTermsUseCase = (
  deps: AcceptTermsDeps,
  args: AcceptTermsArgs,
): ResultAsync<null, UserError> =>
  safeTry(async function* () {
    const termsVersion = yield* validateTermsAgreement(args);

    yield* deps.termsAcceptanceRepository.recordAcceptance(args.userId, termsVersion, args.now);

    return okAsync(null);
  });
