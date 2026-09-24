import { createLocalDrizzleDb, type LocalDrizzleDb } from "../../scripts/lib/d1.js";
import { E2E_PERSIST_TO } from "./e2e-env.js";

/**
 * E2E のアプリが使っている DB。
 *
 * テストの前提となるデータ（団体・施設・予約など）を入れたり、
 * 画面では見えない結果（通知のメールが積まれたか）を確かめたりするのに使う。
 * アプリが動いている最中に書き込んでも、次に画面を開いたときにはもう見える。
 */
export type E2eDb = LocalDrizzleDb["db"];

/** E2E 用の DB を開く。使い終わったら返り値の `sqlite.close()` で閉じる */
export const openE2eDb = (): LocalDrizzleDb => createLocalDrizzleDb(E2E_PERSIST_TO);
