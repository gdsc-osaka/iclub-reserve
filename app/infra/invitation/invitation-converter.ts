import { groupInvitationTable } from "~/db/schema";
import { InvitationStatus, isInvitationStatus, type Invitation } from "~/domain/invitation";
import { toMembershipRole } from "../membership/membership-converter";

type InvitationRow = typeof groupInvitationTable.$inferSelect;

/**
 * DB の group_invitation 行をドメインモデルへ変換する。
 *
 * 【未知の status を InvitationStatus.Pending に倒す理由】
 * このメソッドは主に「承諾待ちの招待があるか」を調べるために使われる。
 * DB 上で想定外の文字列が入っていた場合に「承諾待ちではない」と決めつけると、
 * 実際には生きている招待を見落として同じ宛先に二重の招待を作成してしまう恐れがある。
 * これは toMembershipRole が未知の役割を最小権限の Member に倒しているのと同様、
 * 安全側に倒すための設計判断である。
 */
export const toInvitation = (row: InvitationRow): Invitation => ({
  id: row.id,
  groupId: row.groupId,
  email: row.email,
  role: toMembershipRole(row.role),
  status: isInvitationStatus(row.status) ? row.status : InvitationStatus.Pending,
  expiresAt: row.expiresAt,
  createdAt: row.createdAt,
  inviterUserId: row.inviterId,
});
