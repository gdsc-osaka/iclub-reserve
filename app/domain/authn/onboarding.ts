import { hasAcceptedCurrentTerms } from "./terms-of-service";
import { isProfileCompleted } from "./user-profile";

/**
 * 初回セットアップ画面（SCR-014）で済ませてもらう段階。
 *
 * - terms: 利用規約への同意（REQ-033）
 * - name: お名前の登録（COND-017）
 *
 * 並び順は、画面で尋ねる順番でもある。規約に同意する前にお名前を預からないよう、同意を先にする。
 */
export type OnboardingStep = "terms" | "name";

/** セットアップが済んだかどうかを判定するのに要る、ユーザーの値 */
export type OnboardingUser = {
  readonly name: string;
  /** 同意した規約の版。Better Auth のセッションが持つ列名のまま受け取る */
  readonly terms_version?: string | null;
};

/**
 * まだ済んでいない段階を、尋ねる順に並べて返す。
 *
 * 新しく登録した人は両方が残る。この仕組みより前に登録した人や、
 * 規約が改定された後の人は、お名前は済んでいるので同意だけが残る。
 */
export const toPendingOnboardingSteps = (user: OnboardingUser): readonly OnboardingStep[] => {
  const steps: OnboardingStep[] = [];
  if (!hasAcceptedCurrentTerms(user)) steps.push("terms");
  if (!isProfileCompleted(user)) steps.push("name");
  return steps;
};

/**
 * 本登録（初回セットアップ）が済んでいるかどうか。
 *
 * 認証コードでのログインは、未登録のメールアドレスならその場でアカウントを作る（REQ-031）。
 * そのため「アカウントがあること」は本登録の目印にならない。規約に同意し、お名前を登録して、
 * はじめてアプリの画面を使えるようにする（REQ-033「同意しない場合は登録を完了できない」）。
 */
export const isOnboardingCompleted = (user: OnboardingUser): boolean =>
  toPendingOnboardingSteps(user).length === 0;
