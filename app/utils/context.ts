import { createStorageKey } from 'remix/fetch-router';
import type { RequestContext } from 'remix/fetch-router';

// ── Types ──────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  is_staff: number; // 1 = staff, 0 = normal user
}

export interface Group {
  id: string;
  name: string;
  is_active: number;
}

export interface Membership {
  id: string;
  user_id: string;
  group_id: string;
  role: 'owner' | 'member';
  joined_at: string;
}

export interface Facility {
  id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Reservation {
  id: string;
  group_id: string;
  facility_id: string;
  start_at: string;
  end_at: string;
  headcount: number | null;
  note: string | null;
  status: 'provisional' | 'approved' | 'withdrawn' | 'rejected' | 'cancelled' | 'cancelled_by_staff';
  status_reason: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  reservation_id: string;
  sender_id: string;
  body: string;
  sent_at: string;
}

// ── Context keys ────────────────────────────────────────────────

export const currentUserKey = createStorageKey<User | null>(null);
export const dbKey = createStorageKey<D1Database | null>(null);

// ── Accessors ───────────────────────────────────────────────────

export function getCurrentUser(ctx: RequestContext): User | null {
  return ctx.storage.get(currentUserKey);
}

export function requireUser(ctx: RequestContext): User {
  const user = ctx.storage.get(currentUserKey);
  if (!user) throw new Response('Unauthorized', { status: 401 });
  return user;
}

export function requireStaff(ctx: RequestContext): User {
  const user = requireUser(ctx);
  if (!user.is_staff) throw new Response('Forbidden', { status: 403 });
  return user;
}

export function getDb(ctx: RequestContext): D1Database {
  const db = ctx.storage.get(dbKey);
  if (!db) throw new Error('Database not available in context');
  return db;
}

// ── Helpers ─────────────────────────────────────────────────────

export function statusLabel(status: Reservation['status']): string {
  const labels: Record<Reservation['status'], string> = {
    provisional:       '仮予約',
    approved:          '承認済み',
    withdrawn:         '取り消し済み',
    rejected:          '却下済み',
    cancelled:         'キャンセル済み',
    cancelled_by_staff:'事務局キャンセル済み',
  };
  return labels[status] ?? status;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
