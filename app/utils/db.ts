// D1 database query helpers
import type { User, Group, Membership, Facility, Reservation, Message } from './context.ts';

// ── Users ────────────────────────────────────────────────────────

export async function getUserByEmail(db: D1Database, email: string): Promise<User | null> {
  return db.prepare('SELECT id, email, name, password_hash, is_staff FROM users WHERE email = ?')
    .bind(email.trim().toLowerCase())
    .first<User & { password_hash: string }>();
}

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  return db.prepare('SELECT id, email, name, is_staff FROM users WHERE id = ?')
    .bind(id)
    .first<User>();
}

// ── Sessions ─────────────────────────────────────────────────────

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 86400 * 1000).toISOString();
  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).bind(id, userId, expiresAt, now).run();
  return id;
}

export async function getUserFromSession(db: D1Database, sessionId: string): Promise<User | null> {
  const now = new Date().toISOString();
  return db.prepare(
    `SELECT u.id, u.email, u.name, u.is_staff
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.id = ? AND s.expires_at > ?`,
  ).bind(sessionId, now).first<User>();
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

// ── Groups ────────────────────────────────────────────────────────

export async function getAllGroups(db: D1Database): Promise<Group[]> {
  const { results } = await db.prepare('SELECT * FROM groups ORDER BY name').all<Group>();
  return results;
}

export async function getGroupById(db: D1Database, id: string): Promise<Group | null> {
  return db.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first<Group>();
}

export async function getGroupsForUser(db: D1Database, userId: string): Promise<(Group & { role: string })[]> {
  const { results } = await db.prepare(
    `SELECT g.*, m.role FROM groups g
     JOIN memberships m ON g.id = m.group_id
     WHERE m.user_id = ? ORDER BY g.name`,
  ).bind(userId).all<Group & { role: string }>();
  return results;
}

export async function getMemberships(db: D1Database, groupId: string): Promise<(Membership & { user_name: string; user_email: string })[]> {
  const { results } = await db.prepare(
    `SELECT m.*, u.name as user_name, u.email as user_email
     FROM memberships m JOIN users u ON m.user_id = u.id
     WHERE m.group_id = ? ORDER BY m.role DESC, u.name`,
  ).bind(groupId).all<Membership & { user_name: string; user_email: string }>();
  return results;
}

export async function getUserRoleInGroup(db: D1Database, userId: string, groupId: string): Promise<'owner' | 'member' | null> {
  const row = await db.prepare(
    'SELECT role FROM memberships WHERE user_id = ? AND group_id = ?',
  ).bind(userId, groupId).first<{ role: string }>();
  return (row?.role as 'owner' | 'member') ?? null;
}

// ── Facilities ────────────────────────────────────────────────────

export async function getAllFacilities(db: D1Database, activeOnly = false): Promise<Facility[]> {
  const sql = activeOnly
    ? 'SELECT * FROM facilities WHERE is_active = 1 ORDER BY name'
    : 'SELECT * FROM facilities ORDER BY name';
  const { results } = await db.prepare(sql).all<Facility>();
  return results;
}

export async function getFacilityById(db: D1Database, id: string): Promise<Facility | null> {
  return db.prepare('SELECT * FROM facilities WHERE id = ?').bind(id).first<Facility>();
}

// ── Reservations ──────────────────────────────────────────────────

export async function getReservationById(db: D1Database, id: string): Promise<Reservation | null> {
  return db.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first<Reservation>();
}

export async function getReservationsForGroup(
  db: D1Database,
  groupId: string,
  activeOnly = false,
): Promise<(Reservation & { group_name: string; facility_name: string })[]> {
  const statusFilter = activeOnly
    ? `AND r.status IN ('provisional','approved')`
    : '';
  const { results } = await db.prepare(
    `SELECT r.*, g.name as group_name, f.name as facility_name
     FROM reservations r
     JOIN groups g ON r.group_id = g.id
     JOIN facilities f ON r.facility_id = f.id
     WHERE r.group_id = ? ${statusFilter}
     ORDER BY r.start_at DESC`,
  ).bind(groupId).all<Reservation & { group_name: string; facility_name: string }>();
  return results;
}

export async function getAllReservations(
  db: D1Database,
  statusFilter?: string,
): Promise<(Reservation & { group_name: string; facility_name: string })[]> {
  const where = statusFilter ? `WHERE r.status = '${statusFilter}'` : '';
  const { results } = await db.prepare(
    `SELECT r.*, g.name as group_name, f.name as facility_name
     FROM reservations r
     JOIN groups g ON r.group_id = g.id
     JOIN facilities f ON r.facility_id = f.id
     ${where}
     ORDER BY r.start_at DESC`,
  ).all<Reservation & { group_name: string; facility_name: string }>();
  return results;
}

export async function getReservationsForCalendar(
  db: D1Database,
  year: number,
  month: number,
): Promise<(Reservation & { group_name: string; facility_name: string })[]> {
  const start = `${year}-${String(month).padStart(2, '0')}-01T00:00:00Z`;
  const end = new Date(year, month, 1).toISOString(); // first day of next month
  const { results } = await db.prepare(
    `SELECT r.*, g.name as group_name, f.name as facility_name
     FROM reservations r
     JOIN groups g ON r.group_id = g.id
     JOIN facilities f ON r.facility_id = f.id
     WHERE r.start_at < ? AND r.end_at > ?
       AND r.status IN ('provisional', 'approved')
     ORDER BY r.start_at`,
  ).bind(end, start).all<Reservation & { group_name: string; facility_name: string }>();
  return results;
}

export async function checkOverlap(
  db: D1Database,
  facilityId: string,
  startAt: string,
  endAt: string,
  excludeId?: string,
): Promise<boolean> {
  const excludeClause = excludeId ? `AND id != '${excludeId}'` : '';
  const row = await db.prepare(
    `SELECT 1 FROM reservations
     WHERE facility_id = ? AND status = 'approved'
       AND start_at < ? AND end_at > ? ${excludeClause}`,
  ).bind(facilityId, endAt, startAt).first();
  return !!row;
}

// ── Messages ──────────────────────────────────────────────────────

export async function getMessages(
  db: D1Database,
  reservationId: string,
): Promise<(Message & { sender_name: string; sender_is_staff: number })[]> {
  const { results } = await db.prepare(
    `SELECT m.*, u.name as sender_name, u.is_staff as sender_is_staff
     FROM messages m JOIN users u ON m.sender_id = u.id
     WHERE m.reservation_id = ? ORDER BY m.sent_at`,
  ).bind(reservationId).all<Message & { sender_name: string; sender_is_staff: number }>();
  return results;
}
