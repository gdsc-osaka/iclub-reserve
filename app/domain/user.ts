/** ユーザーを一意に識別する ID */
export type UserId = string;

/**
 * ユーザーを表すドメインモデル。
 *
 * DB のテーブル定義 (snake_case) には依存させず、
 * アプリケーション内で扱いやすい形 (camelCase) に整えている。
 * DB のカラム名が変わっても、この型を変えずに済むようにするのが狙い。
 */
export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly name: string;
  /** 事務局スタッフかどうか */
  readonly isStaff: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
}
