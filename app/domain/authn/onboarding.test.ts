import { describe, expect, it } from "vitest";

import { isOnboardingCompleted, toPendingOnboardingSteps } from "./onboarding";
import { hasAcceptedCurrentTerms, TERMS_OF_SERVICE } from "./terms-of-service";

const CURRENT = TERMS_OF_SERVICE.version;

describe("hasAcceptedCurrentTerms", () => {
  it("今の版に同意していれば true", () => {
    expect(hasAcceptedCurrentTerms({ terms_version: CURRENT })).toBe(true);
  });

  it("一度も同意していない人（null・列が無い）は false", () => {
    expect(hasAcceptedCurrentTerms({ terms_version: null })).toBe(false);
    expect(hasAcceptedCurrentTerms({})).toBe(false);
  });

  it("古い版にだけ同意した人は false（改定後は同意し直してもらう）", () => {
    expect(hasAcceptedCurrentTerms({ terms_version: "2000-01-01" })).toBe(false);
  });
});

describe("toPendingOnboardingSteps", () => {
  it("アカウントを作った直後の人は、同意 → お名前の順に両方が残る", () => {
    expect(toPendingOnboardingSteps({ name: "", terms_version: null })).toEqual(["terms", "name"]);
  });

  it("同意の仕組みより前に登録した人は、同意だけが残る", () => {
    expect(toPendingOnboardingSteps({ name: "阪大 太郎", terms_version: null })).toEqual(["terms"]);
  });

  it("同意した後にお名前を入れずに離脱した人は、お名前だけが残る", () => {
    expect(toPendingOnboardingSteps({ name: "  ", terms_version: CURRENT })).toEqual(["name"]);
  });

  it("両方済んでいれば何も残らない", () => {
    expect(toPendingOnboardingSteps({ name: "阪大 太郎", terms_version: CURRENT })).toEqual([]);
  });
});

describe("isOnboardingCompleted", () => {
  it("同意とお名前の両方が済んで、はじめて本登録が済む", () => {
    expect(isOnboardingCompleted({ name: "阪大 太郎", terms_version: CURRENT })).toBe(true);
    expect(isOnboardingCompleted({ name: "阪大 太郎", terms_version: null })).toBe(false);
    expect(isOnboardingCompleted({ name: "", terms_version: CURRENT })).toBe(false);
  });
});
