import { GroupStatus } from "./index";

/** 事務局が変更先に選べる状態。pending へは戻せない（STATE-002） */
export type GroupStatusChangeTarget = typeof GroupStatus.Enabled | typeof GroupStatus.Disabled;

/**
 * 団体の状態ごとに、次に移ってよい状態（STATE-002 / UC-014）。
 *
 * - pending  -> enabled  （事務局による有効化・利用開始）
 * - pending  -> disabled （事務局による却下・無効化）
 * - enabled  -> disabled （事務局による無効化）
 * - disabled -> enabled  （事務局による再有効化）
 *
 * 「同じ状態への変更」と「pending へ戻す」は載せていないので許されない。
 * 団体は削除せず、無効化で運用する。
 *
 * 許す遷移を書き並べる形にしているのは、状態が増えたときに
 * 新しい遷移が黙って許されないようにするため（書き足さない限り拒否される）。
 *
 * 事務局の団体一覧（/staff/groups）は、この表の並びのとおりに操作のボタンを出す。
 * 承認待ちで「有効化」を先に置いているのは、多くはそちらを選ぶため。
 */
export const allowedGroupStatusTransitions: Readonly<
  Record<GroupStatus, readonly GroupStatusChangeTarget[]>
> = {
  [GroupStatus.Pending]: [GroupStatus.Enabled, GroupStatus.Disabled],
  [GroupStatus.Enabled]: [GroupStatus.Disabled],
  [GroupStatus.Disabled]: [GroupStatus.Enabled],
};

/** 団体の状態を from から to へ変えてよいかどうか */
export const canChangeGroupStatus = (from: GroupStatus, to: GroupStatus): boolean =>
  allowedGroupStatusTransitions[from].some((allowed) => allowed === to);
