import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // route("signin", "routes/signin.tsx"),
  // route("signup", "routes/signup.tsx"),
  route("reservation", "routes/group_reservation.tsx"),
  route("login", "routes/login.tsx"),
  // Better Auth のエンドポイント（/api/auth/... を全て受ける）
  route("api/auth/*", "routes/api.auth.$.ts"),
] satisfies RouteConfig;
