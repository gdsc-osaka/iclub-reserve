/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */
import type { InvitationRepository } from "~/domain/invitation";
import { createUnimplementedFake } from "./stub";

/**
 * テスト用の InvitationRepository の偽物を生成する。
 * 指定されなかったメソッドが呼ばれると Error を投げてテストを失敗させる。
 */
export function fakeInvitationRepository(
  overrides: Partial<InvitationRepository> = {},
): InvitationRepository {
  return createUnimplementedFake("InvitationRepository", overrides);
}
