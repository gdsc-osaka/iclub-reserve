import { GroupStatus } from "./index";

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
 */
const allowedTransitions: Readonly<Record<GroupStatus, readonly GroupStatus[]>> = {
  [GroupStatus.Pending]: [GroupStatus.Enabled, GroupStatus.Disabled],
  [GroupStatus.Enabled]: [GroupStatus.Disabled],
  [GroupStatus.Disabled]: [GroupStatus.Enabled],
};

/** 団体の状態を from から to へ変えてよいかどうか */
export const canChangeGroupStatus = (from: GroupStatus, to: GroupStatus): boolean =>
  allowedTransitions[from].includes(to);
