import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // route("signin", "routes/signin.tsx"),
  // route("signup", "routes/signup.tsx"),
  route("reservation", "routes/group_reservation.tsx"),
] satisfies RouteConfig;
