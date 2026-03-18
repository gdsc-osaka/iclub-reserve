import { createRouter } from 'remix/fetch-router';
import { formData } from 'remix/form-data-middleware';
import { createDbMiddleware } from './middleware/db.ts';
import { loadAuth, requireAuth, requireStaffMiddleware } from './middleware/auth.ts';
import { routes } from './routes.ts';

// Static CSS (embedded as a module with esbuild loader)
import CSS from '../public/styles.css';

// Route handlers
import { loginPage, loginAction, logoutAction } from './auth.tsx';
import { calendarPage } from './calendar.tsx';
import {
  reservationList, newReservationPage, createReservation,
  reservationDetail, editReservationPage, editReservationAction,
  approveReservation, rejectReservation, withdrawReservation,
  cancelReservation, staffCancelReservation, sendMessage,
} from './reservations.tsx';
import {
  groupList, newGroupPage, createGroup, groupDetail,
  addMember, removeMember, changeRole, renameGroup, toggleGroup,
} from './groups.tsx';
import {
  facilityList, createFacility, editFacilityPage, updateFacility, toggleFacility,
} from './facilities.tsx';

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
}

export function createAppRouter(env: Env) {
  const dbMiddleware    = createDbMiddleware(env.DB);
  const auth            = requireAuth();
  const authOptional    = loadAuth();
  const staffOnly       = requireStaffMiddleware();

  const router = createRouter({
    middleware: [formData(), dbMiddleware, authOptional],
  });

  // ── Static assets ─────────────────────────────────────────────
  router.get('/styles.css', () => new Response(CSS, {
    headers: { 'Content-Type': 'text/css; charset=UTF-8', 'Cache-Control': 'public, max-age=86400' },
  }));

  // ── Public routes ─────────────────────────────────────────────
  router.get(routes.home,        () => new Response(null, { status: 302, headers: { Location: '/calendar' } }));
  router.get(routes.login,       loginPage);
  router.post(routes.loginAction, loginAction);
  router.post(routes.logout,     logoutAction);

  // ── Protected routes ──────────────────────────────────────────
  router.get(routes.calendar, {
    middleware: [auth],
    action: calendarPage,
  });

  // Reservations
  router.get(routes.reservations.index,  { middleware: [auth], action: reservationList });
  router.get(routes.reservations.new,    { middleware: [auth], action: newReservationPage });
  router.post(routes.reservations.create, { middleware: [auth], action: createReservation });
  router.get(routes.reservations.show,   { middleware: [auth], action: reservationDetail });
  router.get(routes.reservations.edit,   { middleware: [auth], action: editReservationPage });
  router.post(routes.reservations.editAction,   { middleware: [auth], action: editReservationAction });
  router.post(routes.reservations.approve,      { middleware: [auth, staffOnly], action: approveReservation });
  router.post(routes.reservations.reject,       { middleware: [auth, staffOnly], action: rejectReservation });
  router.post(routes.reservations.withdraw,     { middleware: [auth], action: withdrawReservation });
  router.post(routes.reservations.cancel,       { middleware: [auth], action: cancelReservation });
  router.post(routes.reservations.staffCancel,  { middleware: [auth, staffOnly], action: staffCancelReservation });
  router.post(routes.reservations.messages,     { middleware: [auth], action: sendMessage });

  // Groups
  router.get(routes.groups.index,  { middleware: [auth], action: groupList });
  router.get(routes.groups.new,    { middleware: [auth], action: newGroupPage });
  router.post(routes.groups.create, { middleware: [auth], action: createGroup });
  router.get(routes.groups.show,   { middleware: [auth], action: groupDetail });
  router.post(routes.groups.rename,      { middleware: [auth], action: renameGroup });
  router.post(routes.groups.addMember,   { middleware: [auth], action: addMember });
  router.post(routes.groups.removeMember, { middleware: [auth], action: removeMember });
  router.post(routes.groups.changeRole,  { middleware: [auth], action: changeRole });
  router.post(routes.groups.toggle,      { middleware: [auth, staffOnly], action: toggleGroup });

  // Facilities (staff only)
  router.get(routes.facilities.index,   { middleware: [auth, staffOnly], action: facilityList });
  router.post(routes.facilities.create, { middleware: [auth, staffOnly], action: createFacility });
  router.get(routes.facilities.edit,    { middleware: [auth, staffOnly], action: editFacilityPage });
  router.post(routes.facilities.update, { middleware: [auth, staffOnly], action: updateFacility });
  router.post(routes.facilities.toggle, { middleware: [auth, staffOnly], action: toggleFacility });

  return router;
}
