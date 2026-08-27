import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("reservation", "routes/group_reservation.tsx"),
  route("facility", "routes/registration.tsx"),
  // ログイン・新規登録は認証コード方式では同じ処理になるため 1 つの画面にまとめている
  route("login", "routes/login.tsx"),
  // 初めてログインした人にお名前を登録してもらう画面（ログイン後に通る）
  route("welcome", "routes/onboarding.tsx"),
  // Better Auth のエンドポイント（/api/auth/... を全て受ける）
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("api/users/:userId", "routes/api.user.tsx"),
  route("groups/:groupId", "routes/groups.tsx"),
] satisfies RouteConfig;
