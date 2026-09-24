import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

/*
 * 画面は 1 つにつき 1 フォルダで、入口は必ず `route.tsx` にする。
 * フォルダの位置は URL にそろえ、`:param` は `$param` という名前のフォルダで表す。
 * こうしておくと、URL から画面のファイルを探せる。
 *
 * 画面だけで使う部品や計算は、その画面のフォルダに入れる（例: `routes/reservations/new/`）。
 * 複数の画面で使うものは、種類に応じて次へ出す。
 * - 画面の部品は `app/components/`
 * - 画面を知らない道具（日付・URL など）は `app/lib/`
 * - 画面への出し方の方針（エラーの文言・status など）は `app/routes/_shared/`
 *   ルートはこのファイルで明示しているので、`_shared` がルートとして拾われることはない。
 */
export default [
  /*
   * ログイン後の画面は、すべて共通の外枠（サイドバー・ボトムバー）の中に入れる。
   * ここに追加し忘れると、その画面だけナビゲーションの無い迷子の画面になる。
   */
  layout("routes/app-layout/route.tsx", [
    index("routes/home/route.tsx"),
    route("availability", "routes/availability/route.tsx"),
    /*
     * 団体一覧（SCR-008）。
     * 一般ユーザー向け（/groups）と事務局向け（/staff/groups）に分ける。
     * /staff/reservations と同じく、事務局の画面は機能のフォルダの下に staff/ として置く。
     */
    route("groups", "routes/groups/list/route.tsx"),
    route("staff/groups", "routes/groups/staff/route.tsx"),
    /*
     * 団体登録（SCR-006）のルート。
     * `new` は `:groupId` より具体的なので先に選ばれるが、
     * 意図を明確にするため `groups/:groupId` より前に配置する。
     */
    route("groups/new", "routes/groups/new/route.tsx"),
    route("groups/:groupId", "routes/groups/$groupId/route.tsx"),
    route("invitations/:invitationId", "routes/invitations/$invitationId/route.tsx"),
    /*
     * 施設管理（SCR-009）。
     * 事務局スタッフ限定の画面。登録・編集・無効化を扱う。
     * `new` は `:facilityId` より具体的なので、先に配置する。
     */
    route("staff/facilities", "routes/facilities/staff/route.tsx"),
    route("staff/facilities/new", "routes/facilities/staff/new/route.tsx"),
    route("staff/facilities/:facilityId", "routes/facilities/staff/$facilityId/route.tsx"),
    /*
     * 予約は複数形の `reservations` にそろえる。
     * 一覧（SCR-003）が `/reservations` に入る想定なので（`nav-items.ts`）、
     * 新規作成と詳細もその下にぶら下げる。
     * `new` は `:reservationId` より具体的なので、先に書いていなくても先に選ばれる。
     */
    route("reservations", "routes/reservations/list/route.tsx"),
    route("staff/reservations", "routes/reservations/staff/route.tsx"),
    route("reservations/new", "routes/reservations/new/route.tsx"),
    route("reservations/:reservationId", "routes/reservations/$reservationId/route.tsx"),
    /*
     * アカウント設定（SCR-021）。
     */
    route("account", "routes/account/route.tsx"),
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

  // 施設写真の配信ルート（ADR-005: ログイン必須・プライベートキャッシュ）
  route("facility-photos/:photoName", "routes/facility-photos/$photoName/route.ts"),

  // 開発専用ルート（ローカルでの outbox 手動送信確認用 / ADR-002 実装ガイド 5）
  route("dev/flush-mail", "routes/dev/flush-mail/route.ts"),
] satisfies RouteConfig;
