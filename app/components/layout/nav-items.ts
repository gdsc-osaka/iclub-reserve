import {
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarPlus,
  ClipboardCheck,
  History,
  LayoutDashboard,
  Settings2,
  UserCog,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AppArea } from "./app-area";

/**
 * サイドバー・ボトムバーに並べるナビゲーション項目。
 *
 * サイドバーとボトムバーは同じ内容を別の形で出しているだけなので、
 * 並び順も文言もこのファイルだけを直せば両方に反映される。
 * 片方だけに項目を足すと、PC とスマホで行ける場所が変わってしまう。
 */
export interface NavItem {
  /** React のキーと現在地の判定に使う識別子 */
  readonly id: string;
  /** 画面に出す名前 */
  readonly label: string;
  /** 遷移先のパス */
  readonly to: string;
  readonly icon: LucideIcon;
  /**
   * 遷移先の画面が実装済みかどうか。
   *
   * false の項目はリンクにせず、押せない状態で表示する。
   * 未実装の画面を隠してしまうと、機能が増えるたびにナビの並びが変わり、
   * 「昨日まであった場所に無い」と感じさせてしまう。
   * また、押せてしまうと 404 に落ちる。
   *
   * 画面を実装したら、ここを true にするのと同時に
   * `app/routes.ts` にルートを追加すること。
   */
  readonly enabled: boolean;
  /**
   * 対応する RDRA の画面 ID（`docs/implementation-status.md` の画面一覧）。
   *
   * 要件側に対応する画面が無いものは undefined。
   */
  readonly screen?: string;
  /**
   * 完全一致で現在地を判定するかどうか（React Router の NavLink の end と同じ意味）。
   *
   * ダッシュボードのように他のパスの前方一致になってしまう項目に付ける。
   */
  readonly end?: boolean;
}

/**
 * 件数を添える項目の ID（#189 / ADR-016 決定 7）。
 *
 * - dashboard: 利用者のダッシュボード（団体側の未読と自分宛ての招待の数）
 * - staff-dashboard: 事務局のダッシュボード（団体からの未読メッセージのある予約の数）
 * - staff-approvals: 承認待ちの予約の数（事務局だけ）
 * - staff-groups: 有効化を待っている団体の数（事務局だけ）
 *
 * 件数は外枠の loader（`app/routes/app-layout/`）が数える。
 */
const countedNavItemIds = [
  "dashboard",
  "staff-dashboard",
  "staff-approvals",
  "staff-groups",
] as const;

export type CountedNavItemId = (typeof countedNavItemIds)[number];

/** ナビ項目に添える件数。null は数えなかった（事務局でない）か、数えられなかったことを表す */
export type NavCounts = Readonly<Record<CountedNavItemId, number | null>>;

const isCountedNavItemId = (id: string): id is CountedNavItemId =>
  (countedNavItemIds as readonly string[]).includes(id);

/** 空き状況は利用者の画面と事務局の画面の両方に置く（ADR-016 決定 6 / COND-030 の (3)） */
const availabilityNavItem: NavItem = {
  id: "availability",
  label: "空き状況",
  to: "/availability",
  icon: CalendarDays,
  enabled: true,
  screen: "SCR-001",
};

/**
 * 利用者の画面に出すナビゲーション項目（ADR-016 決定 6）。
 *
 * 所属している団体が 0 件でも「所属団体」を隠さないのは、
 * 団体に入る・団体を登録するための入口がそこにあるため。
 */
export const userNavItems: readonly NavItem[] = [
  {
    id: "dashboard",
    label: "ダッシュボード",
    to: "/",
    icon: LayoutDashboard,
    enabled: true,
    screen: "SCR-022",
    end: true,
  },
  availabilityNavItem,
  {
    id: "reservations",
    label: "予約",
    to: "/reservations",
    icon: CalendarCheck,
    enabled: true,
    screen: "SCR-003",
  },
  {
    id: "groups",
    label: "所属団体",
    to: "/groups",
    icon: Users,
    enabled: true,
    screen: "SCR-008",
  },
];

/**
 * 事務局の画面に出すナビゲーション項目（ADR-016 決定 6）。
 */
export const staffNavItems: readonly NavItem[] = [
  {
    id: "staff-dashboard",
    label: "ダッシュボード",
    to: "/staff",
    icon: LayoutDashboard,
    enabled: true,
    screen: "SCR-022",
    end: true,
  },
  availabilityNavItem,
  {
    id: "staff-approvals",
    label: "予約の承認",
    to: "/staff/reservations",
    icon: ClipboardCheck,
    enabled: true,
    screen: "SCR-003",
  },
  {
    id: "staff-groups",
    label: "団体の管理",
    to: "/staff/groups",
    icon: Building2,
    enabled: true,
    screen: "SCR-008",
  },
  {
    id: "staff-facilities",
    label: "施設・設備の管理",
    to: "/staff/facilities",
    icon: Settings2,
    enabled: true,
    screen: "SCR-009",
  },
  {
    id: "staff-calendars",
    label: "カレンダー購読",
    to: "/staff/calendars",
    icon: CalendarPlus,
    enabled: true,
    screen: "SCR-010",
  },
  {
    id: "staff-audit-log",
    label: "操作履歴",
    to: "/staff/audit-log",
    icon: History,
    enabled: true,
    screen: "SCR-018",
  },
  {
    id: "staff-members",
    label: "事務局の管理",
    to: "/staff/staff-members",
    icon: UserCog,
    enabled: true,
    screen: "SCR-019",
  },
];

/** 領域ごとのナビ項目一覧（ADR-016 決定 6） */
export const areaNavItems: Readonly<Record<AppArea, readonly NavItem[]>> = {
  [AppArea.User]: userNavItems,
  [AppArea.Staff]: staffNavItems,
};

const allNavItems: readonly NavItem[] = [...userNavItems, ...staffNavItems];

/**
 * 予約の申請（事務局は作成）の入口の行き先。サイドバー・ボトムバー・ダッシュボードの見出しのボタンが使う。
 *
 * /reservations/new から空き状況カレンダーへ転送し、時刻を選んでいない欄を開く（ADR-014 決定 10・11）。
 */
export const newReservationPath = "/reservations/new";

/**
 * 予約の申請の入口の文言。
 *
 * 事務局は承認を待たずに作れる（UC-008）ので「予約を作成」にする（ADR-014 決定 9）。
 * どちらの文言にするかは、事務局かどうかではなく開いている画面で決める（ADR-016 決定 6）。
 */
export const toNewReservationLabel = (area: AppArea): string =>
  area === AppArea.Staff ? "予約を作成" : "予約を申請";

/**
 * ボトムバーに直接並べる項目の数。
 *
 * 項目 3 つ・入口・「その他」で 5 つにする。
 * 親指で押せる幅（おおよそ 44px 四方）を確保できるのが、
 * いちばん狭い端末（幅 320px）で 5 つまでのため。
 * これ以上増やすと、隣を押し間違えるようになる。
 */
export const BOTTOM_NAV_SLOT_COUNT = 3;

/**
 * 現在地がこの項目かどうかを判定する。
 *
 * `end: true` の項目は完全一致、それ以外は前方一致で判定する。
 * ダッシュボード（"/" と "/staff"）を前方一致にすると、その下のどの画面を開いていても
 * ダッシュボードが選択中に見えてしまう。
 */
export const isNavItemActive = (item: NavItem, pathname: string): boolean =>
  item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);

/** 領域に応じたナビ項目を、サイドバーに並べる順で返す。 */
export const toNavItems = (area: AppArea): readonly NavItem[] => areaNavItems[area];

/**
 * ボトムバーに直接並べる項目の並び（ID で指定する）。
 *
 * サイドバーの上から順に使うのではなく、ここで選び直している（ADR-016 決定 6）。
 * 事務局の人にとって毎日いちばん使うのは「予約の承認」なので、
 * これを「その他」の中に埋めてしまうと、スマホでの仕事が回らなくなる。
 * 入口を置くために 3 つに減らしたので、利用者の画面の「所属団体」は「その他」に入る。
 */
const bottomNavIds: Readonly<Record<AppArea, readonly string[]>> = {
  [AppArea.User]: ["dashboard", "availability", "reservations"],
  [AppArea.Staff]: ["staff-dashboard", "availability", "staff-approvals"],
};

/**
 * ボトムバーに直接並べる項目を返す。
 *
 * ここに入らなかった項目は、呼び出し側が「その他」の中に出すこと
 * （下の toOverflowNavItems）。どちらにも出ない項目があると、
 * スマホからは永久にたどり着けない画面ができてしまう。
 */
export const toBottomNavItems = (area: AppArea): readonly NavItem[] => {
  const items = toNavItems(area);
  const ids = bottomNavIds[area];

  return ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is NavItem => item !== undefined)
    .slice(0, BOTTOM_NAV_SLOT_COUNT);
};

/** ボトムバーに並びきらず、「その他」の中に入る項目を返す。 */
export const toOverflowNavItems = (area: AppArea): readonly NavItem[] => {
  const shown = new Set(toBottomNavItems(area).map((item) => item.id));

  return toNavItems(area).filter((item) => !shown.has(item.id));
};

/**
 * いま開いている画面のナビ項目を探す。
 *
 * 画面上部に出す名前を決めるために使う。
 * 予約の詳細のようにナビに項目が無い画面では undefined になる。
 */
export const findActiveNavItem = (area: AppArea, pathname: string): NavItem | undefined =>
  toNavItems(area).find((item) => isNavItemActive(item, pathname));

/**
 * 開いた画面が、件数を添える項目の画面かどうか。
 *
 * 件数を数え直す時期を決めるのに使う（その画面を開いたら数え直す）。
 * すべての領域の項目から判定する（`/` と `/staff` の両方が件数を持つ）。
 */
export const isCountedNavPath = (pathname: string): boolean =>
  allNavItems.some((item) => isCountedNavItemId(item.id) && isNavItemActive(item, pathname));

/**
 * その項目に添える件数を返す。件数を持たない項目と、0 件の項目は undefined。
 *
 * 0 件を出さないのは、「やることが無い」項目にまで印が付くと、印のある項目が目に留まらなくなるため。
 */
export const toNavCount = (counts: NavCounts, item: NavItem): number | undefined => {
  const count = isCountedNavItemId(item.id) ? counts[item.id] : null;
  return count !== null && count > 0 ? count : undefined;
};

/**
 * 渡された項目のいずれかに件数があるかどうかを返す。
 *
 * ボトムバーの「その他」の点や、領域切り替えの点の表示判定に使う。
 */
export const hasAnyNavCount = (counts: NavCounts, items: readonly NavItem[]): boolean =>
  items.some((item) => toNavCount(counts, item) !== undefined);

/**
 * バッジに出す件数の文字。100 件以上は "99+" にする。
 *
 * バッジは数字 2 桁分の幅しか無いので、3 桁にすると隣の文字に重なる。
 */
export const formatNavCount = (count: number): string => (count >= 100 ? "99+" : `${count}`);
