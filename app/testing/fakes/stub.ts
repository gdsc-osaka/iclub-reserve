/**
 * テストからだけ使う。アプリのコードから import しないこと。
 */

/**
 * 渡されなかったメソッドが呼ばれた際に、どのメソッドが呼ばれたかが分かる Error を投げる
 * 未実装スタブ（Proxy）を生成する。
 *
 * @param targetName リポジトリやポートの名前（例: "MembershipRepository"）
 * @param overrides テストで個別に差し替えるメソッドの実装
 */
export function createUnimplementedFake<T extends object>(
  targetName: string,
  overrides: Partial<T> = {},
): T {
  return new Proxy(overrides as T, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) {
        return Reflect.get(target, prop, receiver);
      }

      // Promise や Node.js / Vitest の内部チェックなどでアクセスされるプロパティは throw せずに返す
      if (
        typeof prop === "symbol" ||
        prop === "then" ||
        prop === "toJSON" ||
        prop === "constructor" ||
        prop === "$$typeof"
      ) {
        return Reflect.get(target, prop, receiver);
      }

      return (..._args: unknown[]) => {
        throw new Error(
          `${targetName}#${String(prop)} はこのテストで実装されていません（予期しない呼び出しです）`,
        );
      };
    },
  });
}
