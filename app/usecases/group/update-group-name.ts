import { errAsync, ResultAsync } from "neverthrow";

import type { Group, GroupError, GroupRepository } from "~/domain/group";
import { GroupAction } from "~/domain/group";
import { validateGroupName } from "~/domain/group/group-name";
import type { MembershipRepository } from "~/domain/membership";
import { ensureGroupPermission, groupNotFound } from "./_shared/group-authorization";

export interface UpdateGroupNameDeps {
  readonly groupRepository: GroupRepository;
  readonly membershipRepository: MembershipRepository;
}

export interface UpdateGroupNameArgs {
  readonly groupId: string;
  readonly actorUserId: string;
  /** 事務局スタッフかどうか（COND-009）。団体に所属していなくても編集できる */
  readonly isStaff: boolean;
  /** フォームから届いた未検証の団体名 */
  readonly name: string;
  /** 更新日時として書き込む時刻 */
  readonly now: Date;
}

/**
 * 団体名を更新するユースケース（REQ-020 / UC-013）。
 *
 * 【処理の流れと設計上の配慮】
 * 1. groupId のトリム検証:
 *    空文字または空白のみの場合は DB 問い合わせを行わず、即座に groupNotFound() を返す。
 * 2. 団体名のドメイン検証（validateGroupName）:
 *    認可判定（DB 問い合わせ）より前に実行する。入力値の検証は特定の団体に依存しないため、
 *    先に返しても団体の有無が外部に漏れることはない。無効な入力に対して無駄な DB 往復を
 *    確実に 1 回削減できる（Cloudflare D1 のレイテンシとコストの削減）。
 * 3. 事務局スタッフの場合（COND-009）:
 *    事務局は所属の有無に関わらず全団体の管理権限を持つため（COND-009）、
 *    membershipRepository を問い合わせずに直接 updateName を実行する。
 *    事務局に対しては存在秘匿（COND-011）の対象外であるため、団体が存在しない場合は
 *    素直に NotFound が返る。
 * 4. 一般利用者の場合（所属と認可判定）:
 *    先に membershipRepository で所属を確認する。DB エラーは NotFound に潰さず
 *    DatabaseError として返す（潰すとインフラ障害が 404 として誤認され、監視や対応が遅れるため）。
 *    - 閲覧権限（GroupAction.View）がない場合: NotVisible を返す。
 *      利用者への応答を NotFound と同じにして存在を秘匿するのは画面の側である（COND-011 / ADR-004 決定 4）。
 *    - View は通るが Update 権限がない場合（一般メンバー）:
 *      Forbidden「団体情報を編集できるのは管理者と事務局だけです。」を返す。
 *      この利用者は既に画面を開いており、団体の存在を知っているため、ここで 404 を装っても
 *      秘匿上の意味がなく、単に「なぜ保存できないのか分からない不親切な画面」になってしまうため。
 *    - 権限確認が通った場合: 検証済みの名前で groupRepository.updateName を呼び出す。
 */
export const updateGroupNameUseCase = (
  deps: UpdateGroupNameDeps,
  args: UpdateGroupNameArgs,
): ResultAsync<Group, GroupError> => {
  const groupId = args.groupId.trim();

  // 1. 空文字や空白のみの ID は DB へ問い合わせずに即座に打ち切る
  if (groupId === "") {
    return errAsync(groupNotFound());
  }

  // 2. 団体名のバリデーション（団体に依存しないため、認可より先に実行して DB 往復を節約する）
  const nameValidationResult = validateGroupName(args.name);
  if (nameValidationResult.isErr()) {
    return errAsync(nameValidationResult.error);
  }
  const validatedName = nameValidationResult.value;

  // 3. 認可判定（存在秘匿と権限の出し分けは共通の関数が持つ）
  return ensureGroupPermission(deps, { ...args, groupId }, GroupAction.Update).andThen(() =>
    // 4. 団体名を更新する
    deps.groupRepository.updateName({
      id: groupId,
      name: validatedName,
      updatedAt: args.now,
    }),
  );
};
