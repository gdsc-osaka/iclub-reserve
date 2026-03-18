import { h } from 'preact';
import { createRouter } from 'remix/fetch-router';
import { formData } from 'remix/form-data-middleware';
import { session } from 'remix/session-middleware';
import render from 'preact-render-to-string';
import { sessionCookie, sessionStorage } from './utils/session';
import { HomeRoute } from './routes/home';
import { FacilitiesRoute } from './routes/facilities';
import { FacilityRoute } from './routes/facility';
import { DashboardRoute } from './routes/dashboard';
import { AdminRoute } from './routes/admin';

export function getDb(request: any) {
  return request.db;
}

export const createAppRouter = (env: any) => {
  const router = createRouter({
    middleware: [
      formData(),
      session(sessionCookie, sessionStorage),
      async (request: any, next: any) => {
        request.db = env.DB;
        return await next();
      }
    ] as any
  });

  const renderResponse = (Component: any, props: any = {}) => {
    const html = '<!DOCTYPE html>\n' + render(Component(props));
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      }
    });
  };

  router.get('/', async (request: any) => {
    const userId = request.session.get('userId');
    let user = null;
    if (userId) {
      const db = getDb(request);
      user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
      if (user) {
        return new Response('', { status: 302, headers: { Location: '/facilities' } });
      }
    }
    return renderResponse(HomeRoute, { user: null });
  });

  router.post('/login', async (request: any) => {
    const body = request.formData;
    const userId = body.get('userId') as string;
    if (!userId) return new Response('User ID required', { status: 400 });
    
    request.session.set('userId', userId);
    
    return new Response('', { status: 302, headers: { Location: '/facilities' } });
  });

  router.get('/logout', async (request: any) => {
    request.session.destroy();
    return new Response('', { status: 302, headers: { Location: '/' } });
  });

  router.get('/facilities', async (request: any) => {
    const userId = request.session.get('userId');
    let user = null;
    const db = getDb(request);
    if (userId) {
      user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    }
    const { results: facilities } = await db.prepare('SELECT * FROM facilities WHERE is_active = 1').all();
    return renderResponse(FacilitiesRoute, { user, facilities });
  });

  router.get('/facilities/:id', async (request: any) => {
    const userId = request.session.get('userId');
    const db = getDb(request);
    let user = null;
    if (userId) {
      user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    }
    
    const parts = new URL(request.url).pathname.split('/');
    const id = parts[parts.length - 1];

    const facility = await db.prepare('SELECT * FROM facilities WHERE id = ?').bind(id).first();
    if (!facility) return new Response('Not Found', { status: 404 });

    const { results: reservations } = await db.prepare(`
      SELECT r.*, g.name as group_name 
      FROM reservations r 
      JOIN groups g ON r.group_id = g.id 
      WHERE r.facility_id = ? AND r.status IN ('provisional', 'approved')
      ORDER BY r.start_at ASC
    `).bind(facility.id).all();
    
    return renderResponse(FacilityRoute, { user, facility, reservations });
  });

  router.post('/facilities/:id/reserve', async (request: any) => {
    const userId = request.session.get('userId');
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const db = getDb(request);
    const body = request.formData;
    
    const parts = new URL(request.url).pathname.split('/');
    const id = parts[parts.length - 2];

    const membership = await db.prepare('SELECT group_id FROM memberships WHERE user_id = ? LIMIT 1').bind(userId).first();
    if (!membership) return new Response('User does not belong to any group', { status: 400 });

    const startAt = body.get('date') + 'T' + body.get('startTime') + ':00Z';
    const endAt = body.get('date') + 'T' + body.get('endTime') + ':00Z';
    const headcount = parseInt(body.get('headcount') as string, 10);
    const note = body.get('note') as string;
    const resId = 'res_' + Date.now();

    await db.prepare(`
      INSERT INTO reservations (id, group_id, facility_id, start_at, end_at, headcount, note, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'provisional', ?)
    `).bind(resId, membership.group_id, id, startAt, endAt, headcount, note, userId).run();

    return new Response('', { status: 302, headers: { Location: '/dashboard' } });
  });

  router.get('/dashboard', async (request: any) => {
    const userId = request.session.get('userId');
    if (!userId) return new Response('', { status: 302, headers: { Location: '/' } });

    const db = getDb(request);
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    if (!user) return new Response('Unauthorized', { status: 401 });

    const { results: reservations } = await db.prepare(`
      SELECT r.*, f.name as facility_name 
      FROM reservations r 
      JOIN facilities f ON r.facility_id = f.id
      JOIN memberships m ON r.group_id = m.group_id
      WHERE m.user_id = ?
      ORDER BY r.start_at DESC
    `).bind(userId).all();

    return renderResponse(DashboardRoute, { user, reservations });
  });

  router.post('/reservations/:id/cancel', async (request: any) => {
    const userId = request.session.get('userId');
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const db = getDb(request);
    const parts = new URL(request.url).pathname.split('/');
    const id = parts[parts.length - 2];

    await db.prepare(`UPDATE reservations SET status = 'cancelled' WHERE id = ?`).bind(id).run();

    return new Response('', { status: 302, headers: { Location: '/dashboard' } });
  });

  router.get('/admin', async (request: any) => {
    const userId = request.session.get('userId');
    if (!userId) return new Response('', { status: 302, headers: { Location: '/' } });

    const db = getDb(request);
    const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_staff = 1').bind(userId).first();
    if (!user) return new Response('Forbidden: Staff only', { status: 403 });

    const { results: pendingReservations } = await db.prepare(`
      SELECT r.*, f.name as facility_name, g.name as group_name, u.name as created_by_name
      FROM reservations r 
      JOIN facilities f ON r.facility_id = f.id
      JOIN groups g ON r.group_id = g.id
      JOIN users u ON r.created_by = u.id
      WHERE r.status = 'provisional'
      ORDER BY r.start_at ASC
    `).all();

    return renderResponse(AdminRoute, { user, pendingReservations });
  });

  router.post('/admin/reservations/:id/approve', async (request: any) => {
    const userId = request.session.get('userId');
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const db = getDb(request);
    const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_staff = 1').bind(userId).first();
    if (!user) return new Response('Forbidden: Staff only', { status: 403 });

    const parts = new URL(request.url).pathname.split('/');
    const id = parts[parts.length - 2];

    await db.prepare(`UPDATE reservations SET status = 'approved' WHERE id = ?`).bind(id).run();

    return new Response('', { status: 302, headers: { Location: '/admin' } });
  });

  router.post('/admin/reservations/:id/reject', async (request: any) => {
    const userId = request.session.get('userId');
    if (!userId) return new Response('Unauthorized', { status: 401 });

    const db = getDb(request);
    const user = await db.prepare('SELECT * FROM users WHERE id = ? AND is_staff = 1').bind(userId).first();
    if (!user) return new Response('Forbidden: Staff only', { status: 403 });

    const parts = new URL(request.url).pathname.split('/');
    const id = parts[parts.length - 2];

    await db.prepare(`UPDATE reservations SET status = 'rejected' WHERE id = ?`).bind(id).run();

    return new Response('', { status: 302, headers: { Location: '/admin' } });
  });

  return router;
};
