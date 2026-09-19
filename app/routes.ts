import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

/*
 * 画面は 1 つにつき 1 フォルダで、入口は必ず `route.tsx` にする。
 * フォルダの位置は URL にそろえ、`:param` は `$param` という名前のフォルダで表す。
 * こうしておくと、URL から画面のファイルを探せる。
 *
 * 画面だけで使う部品や計算は、その画面のフォルダに入れる（例: `routes/reservations/new/`）。
 * 複数の画面で使うものは `app/components/`・`app/lib/` へ出す。
 */
export default [
  /*
   * ログイン後の画面は、すべて共通の外枠（サイドバー・ボトムバー）の中に入れる。
   * ここに追加し忘れると、その画面だけナビゲーションの無い迷子の画面になる。
   */
  layout("routes/app-layout/route.tsx", [
    index("routes/home/route.tsx"),
    route("availability", "routes/availability/route.tsx"),
    route("facility", "routes/facility/route.tsx"),
    route("groups/:groupId", "routes/groups/$groupId/route.tsx"),
    route("facility/:facilityId", "routes/facility/$facilityId/route.tsx"),
    /*
     * 予約は複数形の `reservations` にそろえる。
     * 一覧（SCR-003）が `/reservations` に入る想定なので（`nav-items.ts`）、
     * 新規作成と詳細もその下にぶら下げる。
     * `new` は `:reservationId` より具体的なので、先に書いていなくても先に選ばれる。
     */
    route("reservations/new", "routes/reservations/new/route.tsx"),
    route("reservations/:reservationId", "routes/reservations/$reservationId/route.tsx"),
  ]),

  /*
   * ログインの途中で通る画面。まだログインしていない人も開くので、
   * 外枠（ナビゲーション）の外に置いている。
   */
  // ログイン・新規登録は認証コード方式では同じ処理になるため 1 つの画面にまとめている
  route("login", "routes/login/route.tsx"),
  // 初めてログインした人にお名前を登録してもらう画面（ログイン後に通る）
  route("welcome", "routes/welcome/route.tsx"),
  // 認証コードでログインしている人に、パスキーの登録を勧める画面（ログイン後に通る）
  route("passkey/suggest", "routes/passkey/suggest/route.tsx"),

  // Better Auth のエンドポイント（/api/auth/... を全て受ける）
  route("api/auth/*", "routes/api/auth/route.ts"),
] satisfies RouteConfig;
