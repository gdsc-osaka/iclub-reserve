import { createAccessControl, type RoleStatements } from "better-auth/plugins";
import { defaultStatements } from "better-auth/plugins/organization/access";

import { roleCan } from "~/domain/authz";
import { GroupAction, groupPermissions } from "~/domain/group";
import { MembershipRole } from "~/domain/membership";

/**
 * Better Auth の組織プラグインが使う権限の一覧 (statement)。
 *
 * `defaultStatements` は organization / member / invitation / team / ac の 5 つ。
 * 独自の権限を足したくなったらここを広げるが、まずは既定のままで足りている。
 */
export const ac = createAccessControl(defaultStatements);

/**
 * ドメインの権限表を Better Auth の statement に翻訳する。
 *
 * Better Auth 内蔵の組織 API (updateOrganization / createInvitation など) は
 * ここで作ったロールを使って認可するため、ドメイン側の表と必ず一致していないと
 * 「画面には編集ボタンが出ないのに API では通る」といった食い違いが起きる。
 * 手で二重に書くと片方だけ直したときにずれるので、ここで導出する。
 *
 * 資源ごとに分かれている表を 1 つの statement に畳む場所でもあるので、
 * 「ある役割が結局なにを許されているか」を一望したいときはここを見る。
 *
 * NOTE: GroupAction.View に対応する statement は Better Auth 側に無い。
 * 閲覧の認可は自前のユースケースが担当する。
 */
const toStatements = (role: MembershipRole) =>
  ({
    organization: roleCan(groupPermissions, role, GroupAction.Update) ? ["update"] : [],

    invitation: roleCan(groupPermissions, role, GroupAction.InviteMember)
      ? ["create", "cancel"]
      : [],

    member: [
      ...(roleCan(groupPermissions, role, GroupAction.RemoveMember) ? (["delete"] as const) : []),
      ...(roleCan(groupPermissions, role, GroupAction.UpdateMemberRole)
        ? (["update"] as const)
        : []),
    ],

    // チーム機能は使っていない
    team: [] as const,

    /*
     * ac の statement を使うエンドポイントは dynamicAccessControl を
     * 有効にしたときにしか登録されない。今は無効なので誰にも許可しない。
     */
    ac: [] as const,
  }) satisfies RoleStatements<typeof ac.statements>;

/**
 * グループの管理者。グループ情報の編集とメンバーの招待ができる。
 *
 * NOTE: Better Auth の既定の owner ロールと違い、組織の削除権限は持たない。
 * 予約が紐づくグループを物理削除すると外部キー違反になるため、
 * 無効化 (GroupStatus.Disabled) で運用する。
 */
export const admin = ac.newRole(toStatements(MembershipRole.Admin));

/** グループの一般メンバー。閲覧だけができる。 */
export const member = ac.newRole(toStatements(MembershipRole.Member));
