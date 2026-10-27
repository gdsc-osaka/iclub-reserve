/**
 * 画面の領域（利用者の画面・事務局の画面）。
 *
 * ADR-016 決定 1・2 に従い、外枠やナビゲーションの出し分けに使用する。
 * ログイン後の行き先を決める loader（`app/routes/start/`）からも使うので、
 * フックは使わず、引数だけで決まる関数にしている。
 */
export const AppArea = { User: "user", Staff: "staff" } as const;
export type AppArea = (typeof AppArea)[keyof typeof AppArea];

/** 両方に置く画面（COND-030 の (3)）の URL の頭。利用者の画面は付けず、事務局の画面は `/staff` を付ける */
const sharedScreenPrefix: Readonly<Record<AppArea, string>> = {
  [AppArea.User]: "",
  [AppArea.Staff]: "/staff",
};
export const toSharedScreenPath = (area: AppArea, path: string): string =>
  `${sharedScreenPrefix[area]}${path}`;

/** 各領域のダッシュボードの URL（ADR-016 決定 8）。頭を付ける形にならないので、`toSharedScreenPath` では作らない */
const areaDashboardPath: Readonly<Record<AppArea, string>> = {
  [AppArea.User]: "/",
  [AppArea.Staff]: "/staff",
};
export const toAreaDashboardPath = (area: AppArea): string => areaDashboardPath[area];

/** パスから事務局の画面の頭（`/staff`）を外す。利用者の画面のパスはそのまま返す */
const stripSharedScreenPrefix = (pathname: string): string => {
  const staffPrefix = sharedScreenPrefix[AppArea.Staff];
  return pathname.startsWith(`${staffPrefix}/`) ? pathname.slice(staffPrefix.length) : pathname;
};

/**
 * 切り替えで、もう一方の画面の同じものへ移れる予約の詳細・団体管理（頭を外したパス）。
 * 作成（`new`）と変更（`/edit`）の入口は、開くとすぐ空き状況へ転送するので入れない。
 */
const switchableDetailPattern = /^\/(?:reservations|groups)\/(?!new$)[^/]+$/;

/**
 * 空き状況で切り替えるときに引き継ぐクエリ（ADR-016 決定 16）。
 * 欄で開いているもの（予約・仮の枠・変更）は、欄の作り方と受け付ける操作が画面で変わるので引き継がない。
 */
const availabilitySwitchParams = ["facility", "date"] as const;

/**
 * 切り替え（`area-switch.tsx`）で移る先の URL を組み立てる（COND-030 の (4)・ADR-016 決定 16）。
 *
 * - 両方に置く画面を開いているときは、もう一方の画面の同じもの（同じ予約・同じ団体・同じ施設と日の空き状況）へ移す。
 * - それ以外の画面と、`target` と同じ画面を開いているときは、`target` の画面のダッシュボードへ移す。
 *   予約の一覧と団体の一覧は、利用者の画面（自団体・所属団体）と事務局の画面（全団体）で別の画面なので、これに入る。
 */
export const toAreaSwitchPath = (
  target: AppArea,
  location: { readonly pathname: string; readonly search: string },
): string => {
  if (toAreaFromPathname(location.pathname) === target) return toAreaDashboardPath(target);

  const path = stripSharedScreenPrefix(location.pathname);
  if (path === "/availability") {
    const current = new URLSearchParams(location.search);
    const carried = new URLSearchParams();
    for (const name of availabilitySwitchParams) {
      const value = current.get(name);
      if (value !== null) carried.set(name, value);
    }
    const query = carried.toString();
    return `${toSharedScreenPath(target, path)}${query === "" ? "" : `?${query}`}`;
  }
  if (switchableDetailPattern.test(path)) return toSharedScreenPath(target, path);

  return toAreaDashboardPath(target);
};

/**
 * URL のパスから画面の領域を判定する（ADR-016 決定 2・10）。
 *
 * - `/staff` と `/staff/` で始まるパス → 事務局（`/staff-invitations/...` などは含まない）
 * - `/`・`/availability`・`/reservations` と `/reservations/...`・`/groups` と `/groups/...` → 利用者
 * - それ以外 → null（どちらでもない）
 */
export const toAreaFromPathname = (pathname: string): AppArea | null => {
  if (pathname === "/staff" || pathname.startsWith("/staff/")) {
    return AppArea.Staff;
  }
  if (
    pathname === "/" ||
    pathname === "/availability" ||
    pathname === "/reservations" ||
    pathname.startsWith("/reservations/") ||
    pathname === "/groups" ||
    pathname.startsWith("/groups/")
  ) {
    return AppArea.User;
  }
  return null;
};

/**
 * 外枠に出す領域を解決する（ADR-016 決定 3）。
 *
 * 事務局でなければいつも利用者。事務局なら pathArea ?? lastArea ?? AppArea.Staff。
 */
export const resolveShellArea = ({
  isStaff,
  pathArea,
  lastArea,
}: {
  readonly isStaff: boolean;
  readonly pathArea: AppArea | null;
  readonly lastArea: AppArea | null;
}): AppArea => {
  if (!isStaff) return AppArea.User;
  return pathArea ?? lastArea ?? AppArea.Staff;
};

/**
 * クッキーなどの文字列から AppArea を安全に取り出す。
 *
 * "user" または "staff" 以外は null を返す。
 */
export const parseAppArea = (value: string | null): AppArea | null => {
  if (value === AppArea.User) return AppArea.User;
  if (value === AppArea.Staff) return AppArea.Staff;
  return null;
};
