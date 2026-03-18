import { get, post } from 'remix/fetch-router/routes';

export const routes = {
  home:    get('/'),
  login:   get('/login'),
  loginAction: post('/login'),
  logout:  post('/logout'),

  calendar: get('/calendar'),

  reservations: {
    index:  get('/reservations'),
    new:    get('/reservations/new'),
    create: post('/reservations'),
    show:   get('/reservations/:id'),
    edit:   get('/reservations/:id/edit'),
    editAction:   post('/reservations/:id/edit'),
    approve:      post('/reservations/:id/approve'),
    reject:       post('/reservations/:id/reject'),
    withdraw:     post('/reservations/:id/withdraw'),
    cancel:       post('/reservations/:id/cancel'),
    staffCancel:  post('/reservations/:id/staff-cancel'),
    messages:     post('/reservations/:id/messages'),
  },

  groups: {
    index:    get('/groups'),
    new:      get('/groups/new'),
    create:   post('/groups'),
    show:     get('/groups/:id'),
    rename:   post('/groups/:id/rename'),
    addMember:    post('/groups/:id/members'),
    removeMember: post('/groups/:id/members/remove'),
    changeRole:   post('/groups/:id/role'),
    toggle:       post('/groups/:id/toggle'),
  },

  facilities: {
    index:  get('/facilities'),
    create: post('/facilities'),
    edit:   get('/facilities/:id/edit'),
    update: post('/facilities/:id/update'),
    toggle: post('/facilities/:id/toggle'),
  },
};
