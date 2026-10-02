/**
 * 団体に必ず残さなければならない管理者の最小人数。
 *
 * 現在のシステムには団体の削除機能がまだ存在せず、管理者が 0 人になってしまうと
 * その団体は事務局スタッフの手を借りない限りメンバーの招待や役割変更など一切の操作を行えなくなる。
 * そのため、通常の運用において管理者が 0 人になる状態をシステム側で確実に防ぐ必要がある。
 */
export const GROUP_MIN_ADMIN_COUNT = 1;

/**
 * 操作の実行後に、団体の管理者が居なくなってしまう（最小人数を下回る）かを判定する純粋関数。
 *
 * 【なぜ「自分自身が対象かどうか」をここで見ないのか】
 * 「自分の降格や脱退は、他に管理者が残っている限り許容する」という運用方針を採用している。
 * 「操作後に管理者が 1 人以上残るか」という単一の不変条件によって、自分自身の操作か他人の操作かを
 * 区別することなく自然に満たされるためである。
 * ここで「自分かどうか」の分岐を足してしまうと、「自分は降格できないのに他人は降格できる」といった
 * 不自然で説明のつかない挙動を生む原因となるため、純粋に対象の役割変化と管理者数のみから判定する。
 */
export const wouldRemoveLastAdmin = (args: {
  /** 操作する前の、その団体の管理者の人数 */
  readonly adminCount: number;
  /** 操作の対象が、現在管理者かどうか */
  readonly targetIsAdmin: boolean;
  /** 操作したあとも、対象が管理者のままかどうか（メンバーへの降格や削除なら false） */
  readonly targetStaysAdmin: boolean;
}): boolean => {
  // 管理者を減らす操作（現在管理者であり、操作後に管理者でなくなる）でない場合は、
  // 人数が減ることはないため false（既存の破損状態を理由に無関係な操作を止めない）
  const isReducingAdmin = args.targetIsAdmin && !args.targetStaysAdmin;
  if (!isReducingAdmin) {
    return false;
  }

  // 操作後の人数 = 現在の管理者数 - 1
  const remainingAdmins = args.adminCount - 1;

  return remainingAdmins < GROUP_MIN_ADMIN_COUNT;
};
