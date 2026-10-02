import { createId } from "@paralleldrive/cuid2";
import { errAsync, type ResultAsync } from "neverthrow";

import type { Group, GroupError, GroupRepository } from "~/domain/group";
import { validateGroupName } from "~/domain/group/group-name";

export interface CreateGroupDeps {
  readonly groupRepository: GroupRepository;
}

export interface CreateGroupArgs {
  /** 作成する人。この人が初期の管理者になる */
  readonly actorUserId: string;
  /** フォームから届いた未検証の団体名 */
  readonly name: string;
  /** 作成日時として書き込む時刻 */
  readonly now: Date;
}

/**
 * 団体を新規作成するユースケース（UC-010 / REQ-016）。
 *
 * 【設計上の配慮と決定理由】
 * 1. 認可の判定を一切しない理由:
 *    REQ-016 により団体の作成に事前の承認も特別な権限も要らない。
 *    ログイン済みであること自体が唯一の条件であり、それはルート側の境界（requireRequestUser）で
 *    満たされているため、ユースケース内での認可判定は行わない。
 * 2. actorUserId を検証しない理由:
 *    セッション由来の値であり、クライアントのフォームから届く未検証の入力値ではないため。
 * 3. 団体名の重複を検査しない理由:
 *    COND-011（団体情報の存在秘匿）。「その名前はすでに使われています」というエラーを返すと、
 *    所属していない団体の存在を総当たりで調べられてしまうため、重複チェックは行わない。
 *    同様の理由から、DB スキーマ上でも団体名に一意制約は設けていない。
 * 4. 団体名検証の先行実行:
 *    validateGroupName で入力を検証し、不正な場合は即座にエラーを返して DB を引かない。
 *    無効な入力に対する無駄な DB 往復を確実に削減する。
 */
export const createGroupUseCase = (
  deps: CreateGroupDeps,
  args: CreateGroupArgs,
): ResultAsync<Group, GroupError> => {
  // 1. 団体名のバリデーション（DB を引く前に検証して不要な問い合わせを防ぐ）
  const nameValidationResult = validateGroupName(args.name);
  if (nameValidationResult.isErr()) {
    return errAsync(nameValidationResult.error);
  }
  const validatedName = nameValidationResult.value;

  // 2. 団体と初期管理者を作成する
  return deps.groupRepository.create({
    id: createId(),
    name: validatedName,
    ownerUserId: args.actorUserId,
    membershipId: createId(),
    now: args.now,
  });
};
