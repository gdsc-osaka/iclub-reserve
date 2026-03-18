import {
  type RouteConfig,
  index,
  layout,
  route,
} from "@react-router/dev/routes";

export default [
  // 認証不要ページ
  route("login", "routes/auth/login.tsx"),
  route("register", "routes/auth/register.tsx"),
  route("register/verify", "routes/auth/verify.tsx"),
  route("logout", "routes/auth/logout.tsx"),

  // 認証済みページ（共通レイアウト）
  layout("routes/_app/layout.tsx", [
    index("routes/_app/index.tsx"),
    route("reservations", "routes/_app/reservations/index.tsx"),
    route("reservations/new", "routes/_app/reservations/new.tsx"),
    route("reservations/:id", "routes/_app/reservations/$id.tsx"),
    route("groups", "routes/_app/groups/index.tsx"),
    route("groups/new", "routes/_app/groups/new.tsx"),
    route("groups/:id", "routes/_app/groups/$id.tsx"),
    route("calendars", "routes/_app/calendars.tsx"),
    // 事務局専用
    route("admin/facilities", "routes/_app/admin/facilities.tsx"),
  ]),
] satisfies RouteConfig;
