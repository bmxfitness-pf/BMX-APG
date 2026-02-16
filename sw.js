const CACHE_NAME = 'app-cache-v2';
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './main.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function readLS(key, fallback) {
  try { const v = self.localStoragePolyfill.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function writeLS(key, val) {
  try { self.localStoragePolyfill.setItem(key, JSON.stringify(val)); } catch {}
}

// Minimal localStorage polyfill using IDB
const DB_NAME = 'sw-store';
const STORE = 'kv';
self.localStoragePolyfill = {
  async init() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  },
  async getItem(k) {
    const db = await this.init();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const get = tx.objectStore(STORE).get(k);
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => reject(get.error);
    });
  },
  async setItem(k, v) {
    const db = await this.init();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const put = tx.objectStore(STORE).put(v, k);
      put.onsuccess = () => resolve();
      put.onerror = () => reject(put.error);
    });
  },
  async removeItem(k) {
    const db = await this.init();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const del = tx.objectStore(STORE).delete(k);
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
    });
  }
};

async function handleApi(event) {
  const url = new URL(event.request.url);
  const { pathname, searchParams } = url;

  // Ensure polyfill initialized
  await self.localStoragePolyfill.init();

  // AUTH
  if (pathname === '/api/auth/login' && event.request.method === 'POST') {
    const body = await event.request.json();
    const username = (body.username || '').trim();
    const role = /admin|owner|manager/i.test(username) ? 'admin' : 'user';
    const ttl = body.remember ? 1000 * 60 * 60 * 24 * 7 : 1000 * 60 * 30;
    const token = Math.random().toString(36).slice(2);
    const exp = Date.now() + ttl;
    await self.localStoragePolyfill.setItem('auth_token', token);
    await self.localStoragePolyfill.setItem('auth_exp', String(exp));
    await self.localStoragePolyfill.setItem('auth_user', JSON.stringify({ username, role }));
    return jsonResponse({ token, exp, user: { username, role } });
  }
  if (pathname === '/api/auth/logout' && event.request.method === 'POST') {
    await self.localStoragePolyfill.removeItem('auth_token');
    await self.localStoragePolyfill.removeItem('auth_exp');
    await self.localStoragePolyfill.removeItem('auth_user');
    return jsonResponse({ ok: true });
  }

  // USERS
  if (pathname === '/api/users') {
    const raw = await self.localStoragePolyfill.getItem('api_users');
    const list = raw ? JSON.parse(raw) : [];
    if (event.request.method === 'GET') return jsonResponse(list);
    if (event.request.method === 'POST') {
      const body = await event.request.json();
      const user = {
        id: crypto.randomUUID(),
        name: body.name,
        role: body.role || 'athlete',
        team: body.team || '',
        ageGroup: body.ageGroup || '',
        category: body.category || '',
        tags: Array.isArray(body.tags) ? body.tags : (typeof body.tags === 'string' && body.tags ? body.tags.split(',').map(s => s.trim()).filter(Boolean) : []),
        status: body.status || 'active'
      };
      const next = list.concat([user]);
      await self.localStoragePolyfill.setItem('api_users', JSON.stringify(next));
      return jsonResponse(user, 201);
    }
  }
  if (pathname.startsWith('/api/users/') && event.request.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const raw = await self.localStoragePolyfill.getItem('api_users');
    const list = raw ? JSON.parse(raw) : [];
    const next = list.filter(u => u.id !== id);
    await self.localStoragePolyfill.setItem('api_users', JSON.stringify(next));
    return jsonResponse({ ok: true });
  }

  // WORKOUTS
  if (pathname === '/api/workouts') {
    const raw = await self.localStoragePolyfill.getItem('api_workouts');
    const list = raw ? JSON.parse(raw) : [];
    if (event.request.method === 'GET') return jsonResponse(list);
    if (event.request.method === 'POST') {
      const body = await event.request.json();
      const w = {
        id: crypto.randomUUID(),
        name: body.name,
        sets: body.sets,
        reps: body.reps,
        load: body.load || '',
        assignedTo: body.assignedTo || '',
        type: body.type || 'Skill',
        duration: Number(body.duration || 0),
        rpe: Number(body.rpe || 0),
        location: body.location || ''
      };
      const next = list.concat([w]);
      await self.localStoragePolyfill.setItem('api_workouts', JSON.stringify(next));
      return jsonResponse(w, 201);
    }
  }
  if (pathname.startsWith('/api/workouts/') && event.request.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const raw = await self.localStoragePolyfill.getItem('api_workouts');
    const list = raw ? JSON.parse(raw) : [];
    const next = list.filter(w => w.id !== id);
    await self.localStoragePolyfill.setItem('api_workouts', JSON.stringify(next));
    return jsonResponse({ ok: true });
  }

  if (pathname === '/api/dump' && event.request.method === 'GET') {
    const users = await self.localStoragePolyfill.getItem('api_users');
    const workouts = await self.localStoragePolyfill.getItem('api_workouts');
    const calendar = await self.localStoragePolyfill.getItem('api_calendar');
    const programs = await self.localStoragePolyfill.getItem('api_programs');
    return jsonResponse({
      users: users ? JSON.parse(users) : [],
      workouts: workouts ? JSON.parse(workouts) : [],
      calendar: calendar ? JSON.parse(calendar) : {},
      programs: programs ? JSON.parse(programs) : []
    });
  }
  if (pathname === '/api/restore' && event.request.method === 'POST') {
    const body = await event.request.json();
    await self.localStoragePolyfill.setItem('api_users', JSON.stringify(body.users || []));
    await self.localStoragePolyfill.setItem('api_workouts', JSON.stringify(body.workouts || []));
    await self.localStoragePolyfill.setItem('api_calendar', JSON.stringify(body.calendar || {}));
    await self.localStoragePolyfill.setItem('api_programs', JSON.stringify(body.programs || []));
    return jsonResponse({ ok: true });
  }

  // PROGRAMS
  if (pathname === '/api/programs') {
    const raw = await self.localStoragePolyfill.getItem('api_programs');
    const list = raw ? JSON.parse(raw) : [];
    if (event.request.method === 'GET') return jsonResponse(list);
    if (event.request.method === 'POST') {
      const body = await event.request.json(); // { name, athleteId, steps:[{offset, name}] }
      const p = { id: crypto.randomUUID(), name: body.name, athleteId: body.athleteId || '', steps: Array.isArray(body.steps) ? body.steps : [] };
      const next = list.concat([p]);
      await self.localStoragePolyfill.setItem('api_programs', JSON.stringify(next));
      return jsonResponse(p, 201);
    }
  }
  if (pathname.startsWith('/api/programs/') && event.request.method === 'DELETE') {
    const id = pathname.split('/').pop();
    const raw = await self.localStoragePolyfill.getItem('api_programs');
    const list = raw ? JSON.parse(raw) : [];
    const next = list.filter(p => p.id !== id);
    await self.localStoragePolyfill.setItem('api_programs', JSON.stringify(next));
    return jsonResponse({ ok: true });
  }
  if (pathname.match(/^\/api\/programs\/[^/]+\/apply$/) && event.request.method === 'POST') {
    const id = pathname.split('/')[3];
    const u = new URL(event.request.url);
    const startStr = u.searchParams.get('start');
    const start = startStr ? new Date(startStr) : new Date();
    const raw = await self.localStoragePolyfill.getItem('api_programs');
    const list = raw ? JSON.parse(raw) : [];
    const prog = list.find(p => p.id === id);
    if (!prog) return jsonResponse({ error: 'not found' }, 404);
    const rawCal = await self.localStoragePolyfill.getItem('api_calendar');
    const cal = rawCal ? JSON.parse(rawCal) : {};
    for (const step of (prog.steps || [])) {
      const d = new Date(start); d.setDate(d.getDate() + Number(step.offset || 0));
      const dayKey = `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
      cal[dayKey] = (cal[dayKey] || []).concat([{ id: crypto.randomUUID(), name: step.name, notes: '', done: false, userId: prog.athleteId || '' }]);
    }
    await self.localStoragePolyfill.setItem('api_calendar', JSON.stringify(cal));
    return jsonResponse({ ok: true });
  }

  // CALENDAR
  if (pathname === '/api/calendar' && event.request.method === 'GET') {
    const raw = await self.localStoragePolyfill.getItem('api_calendar');
    const cal = raw ? JSON.parse(raw) : {};
    return jsonResponse(cal);
  }
  if (pathname === '/api/calendar' && event.request.method === 'POST') {
    const body = await event.request.json();
    const raw = await self.localStoragePolyfill.getItem('api_calendar');
    const cal = raw ? JSON.parse(raw) : {};
    cal[body.dayKey] = (cal[body.dayKey] || []).concat([{
      id: crypto.randomUUID(),
      name: body.name,
      notes: body.notes || '',
      done: !!body.done,
      userId: body.userId || '',
      sessionType: body.sessionType || 'Skill',
      duration: Number(body.duration || 0),
      intensity: Number(body.intensity || 0)
    }]);
    await self.localStoragePolyfill.setItem('api_calendar', JSON.stringify(cal));
    return jsonResponse({ ok: true });
  }
  if (pathname.startsWith('/api/calendar/') && event.request.method === 'PUT') {
    const id = pathname.split('/').pop();
    const body = await event.request.json(); // { dayKey, notes, done }
    const raw = await self.localStoragePolyfill.getItem('api_calendar');
    const cal = raw ? JSON.parse(raw) : {};
    const arr = cal[body.dayKey] || [];
    const idx = arr.findIndex(s => s.id === id);
    if (idx >= 0) arr[idx] = { ...arr[idx], notes: body.notes ?? arr[idx].notes, done: body.done ?? arr[idx].done };
    cal[body.dayKey] = arr;
    await self.localStoragePolyfill.setItem('api_calendar', JSON.stringify(cal));
    return jsonResponse({ ok: true });
  }

  return fetch(event.request);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApi(event));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE_NAME).then(cache => {
        if (event.request.method === 'GET' && resp.status === 200) cache.put(event.request, clone);
      });
      return resp;
    }))
  );
});
