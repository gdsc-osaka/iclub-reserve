import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  /*
   * ログイン後の画面は、すべて共通の外枠（サイドバー・ボトムバー）の中に入れる。
   * ここに追加し忘れると、その画面だけナビゲーションの無い迷子の画面になる。
   */
  layout("routes/app-layout.tsx", [
    index("routes/home.tsx"),
    route("availability", "routes/availability.tsx"),
    route("facility", "routes/registration.tsx"),
    route("groups/:groupId", "routes/groups.tsx"),
    route("facility/:facilityId", "routes/facility.tsx"),
    /*
     * 予約は複数形の `reservations` にそろえる。
     * 一覧（SCR-003）が `/reservations` に入る想定なので（`nav-items.ts`）、
     * 新規作成と詳細もその下にぶら下げる。
     * `new` は `:reservationId` より具体的なので、先に書いていなくても先に選ばれる。
     */
    route("reservations/new", "routes/reservations/new/route.tsx"),
    route("reservations/:reservationId", "routes/reservation.tsx"),
  ]),

  /*
   * ログインの途中で通る画面。まだログインしていない人も開くので、
   * 外枠（ナビゲーション）の外に置いている。
   */
  // ログイン・新規登録は認証コード方式では同じ処理になるため 1 つの画面にまとめている
  route("login", "routes/login.tsx"),
  // 初めてログインした人にお名前を登録してもらう画面（ログイン後に通る）
  route("welcome", "routes/onboarding.tsx"),
  // 認証コードでログインしている人に、パスキーの登録を勧める画面（ログイン後に通る）
  route("passkey/suggest", "routes/passkey.suggest.tsx"),

  // Better Auth のエンドポイント（/api/auth/... を全て受ける）
  route("api/auth/*", "routes/api.auth.$.ts"),
] satisfies RouteConfig;
