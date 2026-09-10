import {
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardCheck,
  LayoutDashboard,
  Settings2,
  Users,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
   * ダッシュボードのように要件側に対応する画面が無いものは undefined。
   */
  readonly screen?: string;
}

/**
 * どの利用者にも出す項目。
 *
 * 所属している団体が 0 件でも「所属団体」を隠さないのは、
 * 団体に入る・団体を登録するための入口がそこにあるため。
 */
export const commonNavItems: readonly NavItem[] = [
  {
    id: "dashboard",
    label: "ダッシュボード",
    to: "/",
    icon: LayoutDashboard,
    enabled: true,
  },
  {
    id: "availability",
    label: "空き状況",
    to: "/availability",
    icon: CalendarDays,
    enabled: false,
    screen: "SCR-001",
  },
  {
    id: "reservations",
    label: "予約",
    to: "/reservations",
    icon: CalendarCheck,
    enabled: false,
    screen: "SCR-003",
  },
  {
    id: "facilities",
    label: "施設・設備",
    to: "/facilities",
    icon: Wrench,
    enabled: false,
    screen: "SCR-009",
  },
  {
    id: "groups",
    label: "所属団体",
    to: "/groups",
    icon: Users,
    enabled: false,
    screen: "SCR-008",
  },
];

/**
 * 事務局スタッフ（`user.is_staff`）にだけ追加で出す項目。
 *
 * 事務局かどうかは団体での役割とは別の軸なので（COND-009）、
 * 上の共通項目を差し替えるのではなく、後ろに足す形にしている。
 * 事務局の人も自分の団体の予約を申請するし、
 * 団体に所属していない事務局の人もいる。
 */
export const staffNavItems: readonly NavItem[] = [
  {
    id: "staff-approvals",
    label: "予約の承認",
    to: "/staff/reservations",
    icon: ClipboardCheck,
    enabled: false,
    screen: "SCR-003",
  },
  {
    id: "staff-groups",
    label: "団体の管理",
    to: "/staff/groups",
    icon: Building2,
    enabled: false,
    screen: "SCR-008",
  },
  {
    id: "staff-facilities",
    label: "施設の管理",
    to: "/staff/facilities",
    icon: Settings2,
    enabled: false,
    screen: "SCR-009",
  },
];

/**
 * ボトムバーに直接並べる項目の数。
 *
 * 5 つ目は「その他」に使うので、ここは 4 まで。
 * 親指で押せる幅（おおよそ 44px 四方）を確保できるのが、
 * いちばん狭い端末（幅 320px）で 5 つまでのため。
 * これ以上増やすと、隣を押し間違えるようになる。
 */
export const BOTTOM_NAV_SLOT_COUNT = 4;

/**
 * 現在地がこの項目かどうかを判定する。
 *
 * ダッシュボードだけ完全一致で判定しているのは、パスが "/" のため。
 * 前方一致にすると、どの画面を開いていてもダッシュボードが
 * 選択中に見えてしまう。
 */
export const isNavItemActive = (item: NavItem, pathname: string): boolean =>
  item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`);

/** その人に出すナビ項目を、サイドバーに並べる順で返す。 */
export const toNavItems = (isStaff: boolean): readonly NavItem[] =>
  isStaff ? [...commonNavItems, ...staffNavItems] : commonNavItems;

/**
 * ボトムバーに直接並べる項目の並び（ID で指定する）。
 *
 * サイドバーの上から 4 つをそのまま使うのではなく、ここで選び直している。
 * 事務局の人にとって毎日いちばん使うのは「予約の承認」なので、
 * これを「その他」の中に埋めてしまうと、スマホでの仕事が回らなくなる。
 */
const bottomNavIds: Readonly<Record<"member" | "staff", readonly string[]>> = {
  member: ["dashboard", "availability", "reservations", "groups"],
  staff: ["dashboard", "availability", "staff-approvals", "reservations"],
};

/**
 * ボトムバーに直接並べる項目を返す。
 *
 * ここに入らなかった項目は、呼び出し側が「その他」の中に出すこと
 * （下の toOverflowNavItems）。どちらにも出ない項目があると、
 * スマホからは永久にたどり着けない画面ができてしまう。
 */
export const toBottomNavItems = (isStaff: boolean): readonly NavItem[] => {
  const items = toNavItems(isStaff);
  const ids = isStaff ? bottomNavIds.staff : bottomNavIds.member;

  return ids
    .map((id) => items.find((item) => item.id === id))
    .filter((item): item is NavItem => item !== undefined)
    .slice(0, BOTTOM_NAV_SLOT_COUNT);
};

/** ボトムバーに並びきらず、「その他」の中に入る項目を返す。 */
export const toOverflowNavItems = (isStaff: boolean): readonly NavItem[] => {
  const shown = new Set(toBottomNavItems(isStaff).map((item) => item.id));

  return toNavItems(isStaff).filter((item) => !shown.has(item.id));
};

/**
 * いま開いている画面のナビ項目を探す。
 *
 * 画面上部に出す名前を決めるために使う。
 * 予約の詳細のようにナビに項目が無い画面では undefined になる。
 */
export const findActiveNavItem = (isStaff: boolean, pathname: string): NavItem | undefined =>
  toNavItems(isStaff).find((item) => isNavItemActive(item, pathname));
