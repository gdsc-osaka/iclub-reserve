/**
 * 役割にもとづく権限の表し方。
 *
 * このファイルが決めるのは「表の形」と「表の読み方」だけで、
 * 中身 (誰が何をできるか) は資源ごとのドメイン (app/domain/group.ts など) が持つ。
 *
 * 「〜できる」は役割ではなく資源の性質なので、置き場所も資源の側が正しい。
 * 表をここに集めると、このファイルが全機能を知ることになり、
 * 機能を足すたびに全機能が共有するファイルを書き換えることになる。
 */

/**
 * 役割ごとに許可される操作を並べた表。
 *
 * `Record` なので役割を 1 つでも書き忘れると型エラーになる。
 * 役割を増やしたとき、どの資源の表を直し忘れているかがコンパイル時に分かる。
 *
 * 型引数を `string` で縛っているのは、役割にも操作にも
 * `as const` で作った文字列ユニオンを渡す前提だから。
 */
export type PermissionTable<R extends string, A extends string> = Readonly<Record<R, readonly A[]>>;

/**
 * その役割単体で操作が許可されるかを判定する。
 *
 * 誰かがその役割を持っているかどうかは見ない。認可の判定に使うときは、
 * 所属の有無まで含めて判定する Membership の `canPerform` を通すこと。
 * この関数を直接使ってよいのは、役割から Better Auth の statement を
 * 組み立てる app/lib/auth/permission.ts のように、
 * 特定の誰かではなく役割そのものを対象にする場合だけ。
 */
export const roleCan = <R extends string, A extends string>(
  table: PermissionTable<R, A>,
  role: R,
  action: A,
): boolean => table[role]?.includes(action) ?? false;

/**
 * 複数の役割のうち、いずれか 1 つでも許可していれば許可する。
 *
 * Better Auth は複数の役割を 1 列にカンマ区切りで持ち、その判定 (hasPermissionFn) も
 * 「いずれかが許可すれば許可」なので、自前の判定が食い違わないようにそろえている。
 *
 * 役割が 1 つも無い場合は false になる。
 */
export const rolesCan = <R extends string, A extends string>(
  table: PermissionTable<R, A>,
  roles: readonly R[],
  action: A,
): boolean => roles.some((role) => roleCan(table, role, action));
