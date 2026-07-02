import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("reservation", "routes/group_reservation.tsx"),
  route("facility", "routes/registration.tsx"),
] satisfies RouteConfig;
