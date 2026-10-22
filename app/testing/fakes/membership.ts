/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { MembershipRepository } from "~/domain/membership";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の MembershipRepository の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeMembershipRepository(
  overrides: Partial<MembershipRepository> = {},
): MembershipRepository {
  return createUnimplementedFake("MembershipRepository", overrides);
}
