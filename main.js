const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  });
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
};

const app = document.getElementById('app');

const storage = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

const theme = {
  init() {
    const m = storage.get('theme', 'dark');
    document.documentElement.dataset.theme = m;
  },
  toggle() {
    const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = cur;
    storage.set('theme', cur);
  }
};

const API = {
  base() { return storage.get('api_base', ''); },
  url(path) {
    const b = this.base();
    if (!b) return path;
    try { return new URL(path, b).toString(); } catch { return path; }
  },
  async _tryJsonFetch(url, init) {
    const r = await fetch(url, init);
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!r.ok || !ct.includes('application/json')) throw new Error('Non-JSON or error response');
    return r.json();
  },
  async get(path) {
    const remote = this.url(path);
    try { return await this._tryJsonFetch(remote); }
    catch { return await this._tryJsonFetch(path); }
  },
  async post(path, body) {
    const remote = this.url(path);
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    try { return await this._tryJsonFetch(remote, init); }
    catch {
      try { return await this._tryJsonFetch(path, init); }
      catch { return {}; }
    }
  },
  async del(path) {
    const remote = this.url(path);
    const init = { method: 'DELETE' };
    try { return await this._tryJsonFetch(remote, init); }
    catch { return await this._tryJsonFetch(path, init); }
  },
  async put(path, body) {
    const remote = this.url(path);
    const init = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
    try { return await this._tryJsonFetch(remote, init); }
    catch { return await this._tryJsonFetch(path, init); }
  }
};

const auth = {
  isAuthed() {
    const token = storage.get('auth_token', null);
    const exp = storage.get('auth_exp', 0);
    if (!token || Date.now() > exp) { this.logout(); return false; }
    return true;
  },
  user() { return storage.get('auth_user', null); },
  async login(username, password, remember) {
    if (!username || !password) return { ok: false, error: 'Enter username and password' };
    const res = await API.post('/api/auth/login', { username, password, remember });
    storage.set('auth_token', res.token);
    storage.set('auth_exp', res.exp);
    storage.set('auth_user', res.user);
    return { ok: true };
  },
  async logout() {
    await API.post('/api/auth/logout', {});
    storage.del('auth_token'); storage.del('auth_exp'); storage.del('auth_user');
  }
};

function headerActions() {
  const header = document.querySelector('.app-header');
  const existing = header.querySelector('.actions');
  if (existing) header.removeChild(existing);
  const actions = el('div', { class: 'actions' }, [
    el('button', { class: 'secondary menu-btn', onClick: () => {
      document.body.dataset.menu = document.body.dataset.menu === 'open' ? '' : 'open';
    } }, ['Menu']),
    el('button', { class: 'secondary', onClick: theme.toggle }, ['Theme']),
    auth.isAuthed()
      ? el('button', { onClick: () => { auth.logout(); location.hash = '#/login'; } }, ['Logout'])
      : el('a', { href: '#/login', class: 'secondary' }, ['Login'])
  ]);
  header.appendChild(actions);
}

function LoginView() {
  const msg = el('div', { class: 'muted' });
  const user = el('input', { class: 'input', placeholder: 'Username', autocomplete: 'username' });
  const pass = el('input', { class: 'input', placeholder: 'Password', type: 'password', autocomplete: 'current-password' });
  const remember = el('input', { type: 'checkbox', id: 'remember' });
  const rememberLbl = el('label', { for: 'remember' }, ['Remember me']);
  const submit = async () => {
    const res = await auth.login(user.value.trim(), pass.value, remember.checked);
    if (!res.ok) { msg.textContent = res.error; return; }
    location.hash = '#/dashboard';
  };
  const form = el('div', { class: 'auth-form' }, [
    el('h2', {}, ['Sign in']),
    msg,
    user,
    pass,
    el('div', { class: 'row' }, [remember, rememberLbl]),
    el('button', { onClick: submit }, ['Sign In'])
  ]);
  return el('section', { class: 'auth' }, [form]);
}

function StatCard(title, value, pct) {
  const bar = el('div', { class: 'bar' }, [el('div', { class: 'bar-fill', style: `width:${pct}%` })]);
  return el('div', { class: 'stat-card card' }, [
    el('div', { class: 'stat-title' }, [title]),
    el('div', { class: 'stat-value accent' }, [value]),
    bar
  ]);
}

function Sparkline(values, label) {
  const w = 300, h = 80, p = 6;
  const wrap = el('div', { class: 'chart' });
  const c = el('canvas', { width: `${w}`, height: `${h}` });
  const tip = el('div', { class: 'tooltip' });
  wrap.appendChild(c);
  wrap.appendChild(tip);
  const ctx = c.getContext('2d');
  const min = Math.min(...values), max = Math.max(...values);
  const sx = (i) => p + i * ((w - p * 2) / (values.length - 1));
  const sy = (v) => h - p - ((v - min) / (max - min || 1)) * (h - p * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#22c55e';
  ctx.beginPath();
  values.forEach((v, i) => { const x = sx(i), y = sy(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  const points = values.map((v, i) => ({ x: sx(i), y: sy(v), v, i }));
  c.addEventListener('mousemove', (e) => {
    const r = c.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let closest = null, cd = Infinity;
    for (const pt of points) {
      const d = Math.hypot(pt.x - mx, pt.y - my);
      if (d < cd) { cd = d; closest = pt; }
    }
    if (closest && cd < 24) {
      tip.classList.add('show');
      tip.textContent = (label ? label + ': ' : '') + closest.v;
      tip.style.left = `${closest.x}px`;
      tip.style.top = `${closest.y}px`;
    } else {
      tip.classList.remove('show');
    }
  });
  c.addEventListener('mouseleave', () => tip.classList.remove('show'));
  return wrap;
}

function DashboardView() {
  const u = auth.user();
  const profile = storage.get('profile', null);
  const active = (route) => location.hash.includes(route) ? 'nav-link active' : 'nav-link';
  const sidebar = el('aside', { class: 'sidebar card' }, [
    el('div', { class: 'sidebar-header' }, ['Menu']),
    el('a', { href: '#/dashboard', class: active('/dashboard'), onClick: () => { document.body.dataset.menu = ''; } }, ['Overview']),
    el('a', { href: '#/calendar', class: active('/calendar'), onClick: () => { document.body.dataset.menu = ''; } }, ['Calendar']),
    el('a', { href: '#/programming', class: active('/programming'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programming']),
    el('a', { href: '#/programs', class: active('/programs'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programs']),
    el('a', { href: '#/analytics', class: active('/analytics'), onClick: () => { document.body.dataset.menu = ''; } }, ['Analytics']),
    el('a', { href: '#/users', class: active('/users'), onClick: () => { document.body.dataset.menu = ''; } }, ['Users']),
    el('a', { href: '#/products', class: active('/products'), onClick: () => { document.body.dataset.menu = ''; } }, ['Products']),
    el('a', { href: '#/profile', class: active('/profile'), onClick: () => { document.body.dataset.menu = ''; } }, ['Profile']),
    el('a', { href: '#/settings', class: active('/settings'), onClick: () => { document.body.dataset.menu = ''; } }, ['Settings'])
  ]);
  const greet = el('div', { class: 'greet' }, [`Hello, ${profile?.displayName || u?.username || 'User'}`]);
  const stats = el('div', { class: 'cards' }, [
    StatCard('Users', '1,240', 72),
    StatCard('Revenue', '$8,420', 54),
    StatCard('Sessions', '3,102', 64),
    StatCard('Churn', '2.1%', 21)
  ]);
  const spark = el('div', { class: 'card' }, [
    el('h3', {}, ['Last 14 Days']),
    Sparkline(Array.from({ length: 14 }, () => Math.floor(Math.random() * 100) + 10), 'Sessions')
  ]);
  const todoList = el('div', { class: 'list' });
  const saved = storage.get('quick_tasks', []);
  saved.forEach((t) => {
    const item = el('div', { class: 'list-item' }, [
      el('span', {}, [t]),
      el('button', { class: 'secondary', onClick: () => {
        todoList.removeChild(item);
        const arr = Array.from(todoList.querySelectorAll('.list-item span')).map(s => s.textContent);
        storage.set('quick_tasks', arr);
      } }, ['Done'])
    ]);
    todoList.appendChild(item);
  });
  const input = el('input', { class: 'input', placeholder: 'Add quick task' });
  const add = () => {
    const t = input.value.trim(); if (!t) return; input.value = '';
    const item = el('div', { class: 'list-item' }, [
      el('span', {}, [t]),
      el('button', { class: 'secondary', onClick: () => {
        todoList.removeChild(item);
        const arr = Array.from(todoList.querySelectorAll('.list-item span')).map(s => s.textContent);
        storage.set('quick_tasks', arr);
      } }, ['Done'])
    ]);
    todoList.appendChild(item);
    const arr = Array.from(todoList.querySelectorAll('.list-item span')).map(s => s.textContent);
    storage.set('quick_tasks', arr);
  };
  const quick = el('div', { class: 'card' }, [
    el('h3', {}, ['Quick Tasks']),
    el('div', { class: 'row' }, [input, el('button', { onClick: add }, ['Add'])]),
    todoList
  ]);
  const content = el('section', { class: 'content' }, [
    el('div', { class: 'topbar' }, [greet]),
    stats,
    spark,
    quick
  ]);
  return el('div', { class: 'layout' }, [sidebar, content]);
}

function AnalyticsView() {
  const active = (route) => location.hash.includes(route) ? 'nav-link active' : 'nav-link';
  const sidebar = el('aside', { class: 'sidebar card' }, [
    el('div', { class: 'sidebar-header' }, ['Menu']),
    el('a', { href: '#/dashboard', class: active('/dashboard'), onClick: () => { document.body.dataset.menu = ''; } }, ['Overview']),
    el('a', { href: '#/calendar', class: active('/calendar'), onClick: () => { document.body.dataset.menu = ''; } }, ['Calendar']),
    el('a', { href: '#/programming', class: active('/programming'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programming']),
    el('a', { href: '#/programs', class: active('/programs'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programs']),
    el('a', { href: '#/analytics', class: active('/analytics'), onClick: () => { document.body.dataset.menu = ''; } }, ['Analytics']),
    el('a', { href: '#/users', class: active('/users'), onClick: () => { document.body.dataset.menu = ''; } }, ['Users']),
    el('a', { href: '#/products', class: active('/products'), onClick: () => { document.body.dataset.menu = ''; } }, ['Products']),
    el('a', { href: '#/profile', class: active('/profile'), onClick: () => { document.body.dataset.menu = ''; } }, ['Profile']),
    el('a', { href: '#/settings', class: active('/settings'), onClick: () => { document.body.dataset.menu = ''; } }, ['Settings'])
  ]);
  const users = storage.get('cache_users', null) || [];
  const workouts = storage.get('cache_workouts', null) || [];
  const byCount = {};
  const byDur = {};
  const byRpe = {};
  workouts.forEach(w => {
    const id = w.assignedTo || 'unassigned';
    byCount[id] = (byCount[id] || 0) + 1;
    byDur[id] = (byDur[id] || 0) + (Number(w.duration) || 0);
    if (w.rpe) byRpe[id] = (byRpe[id] || []).concat([Number(w.rpe)]);
  });
  const labels = Object.keys({ ...byCount, ...byDur });
  const countSeries = labels.map(id => byCount[id] || 0);
  const durSeries = labels.map(id => byDur[id] || 0);
  const chart = el('div', { class: 'card' }, [
    el('h3', {}, ['Workouts per Athlete']),
    el('div', { class: 'row' }, [
      el('span', { class: 'badge success' }, ['Series A'])
    ]),
    Sparkline(countSeries.length ? countSeries : [0], 'Count')
  ]);
  const chart2 = el('div', { class: 'card' }, [
    el('h3', {}, ['Volume (Duration) per Athlete']),
    el('div', { class: 'row' }, [
      el('span', { class: 'badge success' }, ['Series B'])
    ]),
    Sparkline(durSeries.length ? durSeries : [0], 'Minutes')
  ]);
  const distList = el('div', { class: 'list' }, (labels.length ? labels : ['unassigned']).map(id => {
    const name = users.find(u => u.id === id)?.name || (id === 'unassigned' ? 'Unassigned' : id.slice(0,6));
    const count = byCount[id] || 0;
    const vol = byDur[id] || 0;
    const rpes = byRpe[id] || [];
    const avgRpe = rpes.length ? (rpes.reduce((a,b)=>a+b,0)/rpes.length).toFixed(1) : '-';
    return el('div', { class: 'list-item' }, [el('span', {}, [name]), el('span', { class: 'pill' }, [`${count} | ${vol}m | RPE ${avgRpe}`])]);
  }));
  const table = el('div', { class: 'card' }, [
    el('h3', {}, ['Athlete Summary (Count | Minutes | Avg RPE)']),
    distList
  ]);
  const content = el('section', { class: 'content' }, [
    el('div', { class: 'topbar' }, [el('div', { class: 'greet' }, ['Analytics'])]),
    chart,
    chart2,
    table
  ]);
  return el('div', { class: 'layout' }, [sidebar, content]);
}

async function ProgramsView() {
  const active = (route) => location.hash.includes(route) ? 'nav-link active' : 'nav-link';
  const sidebar = el('aside', { class: 'sidebar card' }, [
    el('div', { class: 'sidebar-header' }, ['Menu']),
    el('a', { href: '#/dashboard', class: active('/dashboard'), onClick: () => { document.body.dataset.menu = ''; } }, ['Overview']),
    el('a', { href: '#/calendar', class: active('/calendar'), onClick: () => { document.body.dataset.menu = ''; } }, ['Calendar']),
    el('a', { href: '#/programming', class: active('/programming'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programming']),
    el('a', { href: '#/programs', class: active('/programs'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programs']),
    el('a', { href: '#/analytics', class: active('/analytics'), onClick: () => { document.body.dataset.menu = ''; } }, ['Analytics']),
    el('a', { href: '#/users', class: active('/users'), onClick: () => { document.body.dataset.menu = ''; } }, ['Users']),
    el('a', { href: '#/products', class: active('/products'), onClick: () => { document.body.dataset.menu = ''; } }, ['Products']),
    el('a', { href: '#/profile', class: active('/profile'), onClick: () => { document.body.dataset.menu = ''; } }, ['Profile']),
    el('a', { href: '#/settings', class: active('/settings'), onClick: () => { document.body.dataset.menu = ''; } }, ['Settings'])
  ]);
  const isAdmin = auth.user()?.role === 'admin';
  const [programs, users] = await Promise.all([
    API.get('/api/programs').catch(() => []),
    API.get('/api/users').catch(() => [])
  ]);
  const athletes = users.filter(u => (u.role || '').toLowerCase().includes('athlete'));
  const nameI = el('input', { class: 'input', placeholder: 'Program name' });
  const athleteSel = el('select', { class: 'input' }, [el('option', { value: '' }, ['Unassigned'])].concat(athletes.map(a => el('option', { value: a.id }, [a.name]))));
  const stepsWrap = el('div', { class: 'list' });
  const addStep = () => {
    const offI = el('input', { class: 'input', type: 'number', placeholder: 'Day offset', value: '0' });
    const nmI = el('input', { class: 'input', placeholder: 'Session name' });
    const row = el('div', { class: 'row' }, [offI, nmI, el('button', { class: 'secondary', onClick: () => stepsWrap.removeChild(row) }, ['Remove'])]);
    stepsWrap.appendChild(row);
  };
  addStep();
  const createBtn = el('button', { disabled: isAdmin ? null : 'disabled', onClick: async () => {
    const name = nameI.value.trim();
    if (!name) return;
    const steps = Array.from(stepsWrap.children).map(r => {
      const [offI, nmI] = r.querySelectorAll('input');
      return { offset: Number(offI.value || 0), name: nmI.value.trim() };
    }).filter(s => s.name);
    await API.post('/api/programs', { name, athleteId: athleteSel.value || '', steps });
    location.hash = '#/programs';
  } }, ['Create Program']);
  const addStepBtn = el('button', { class: 'secondary', onClick: addStep }, ['Add Step']);
  const form = el('div', { class: 'card' }, [
    el('h3', {}, ['New Program']),
    el('div', { class: 'row' }, [nameI, athleteSel]),
    stepsWrap,
    el('div', { class: 'row' }, [addStepBtn, createBtn])
  ]);
  const table = el('table', { class: 'table' });
  table.appendChild(el('thead', {}, [el('tr', {}, [el('th', {}, ['Name']), el('th', {}, ['Athlete']), el('th', {}, ['Steps']), el('th', {}, ['Actions'])])]));
  const tb = el('tbody');
  programs.forEach((p) => {
    const athleteName = athletes.find(a => a.id === p.athleteId)?.name || 'Unassigned';
    const tr = el('tr', {}, [
      el('td', {}, [p.name]),
      el('td', {}, [athleteName]),
      el('td', {}, [String((p.steps || []).length)]),
      el('td', {}, [
        el('button', { onClick: async () => {
          const start = prompt('Start date (YYYY-MM-DD)', new Date().toISOString().slice(0,10));
          if (!start) return;
          await API.post(`/api/programs/${p.id}/apply?start=${encodeURIComponent(start)}`, {});
          alert('Program applied to calendar');
        } }, ['Apply']),
        el('button', { class: 'secondary', disabled: isAdmin ? null : 'disabled', onClick: async () => {
          await API.del(`/api/programs/${p.id}`);
          location.hash = '#/programs';
        } }, ['Delete'])
      ])
    ]);
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  const content = el('section', { class: 'content' }, [
    el('div', { class: 'topbar' }, [el('div', { class: 'greet' }, ['Programs'])]),
    form,
    el('div', { class: 'card' }, [table])
  ]);
  return el('div', { class: 'layout' }, [sidebar, content]);
}
async function CalendarView() {
  const active = (route) => location.hash.includes(route) ? 'nav-link active' : 'nav-link';
  const sidebar = el('aside', { class: 'sidebar card' }, [
    el('div', { class: 'sidebar-header' }, ['Menu']),
    el('a', { href: '#/dashboard', class: active('/dashboard'), onClick: () => { document.body.dataset.menu = ''; } }, ['Overview']),
    el('a', { href: '#/calendar', class: active('/calendar'), onClick: () => { document.body.dataset.menu = ''; } }, ['Calendar']),
    el('a', { href: '#/programming', class: active('/programming'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programming']),
    el('a', { href: '#/programs', class: active('/programs'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programs']),
    el('a', { href: '#/analytics', class: active('/analytics'), onClick: () => { document.body.dataset.menu = ''; } }, ['Analytics']),
    el('a', { href: '#/users', class: active('/users'), onClick: () => { document.body.dataset.menu = ''; } }, ['Users']),
    el('a', { href: '#/products', class: active('/products'), onClick: () => { document.body.dataset.menu = ''; } }, ['Products']),
    el('a', { href: '#/profile', class: active('/profile'), onClick: () => { document.body.dataset.menu = ''; } }, ['Profile']),
    el('a', { href: '#/settings', class: active('/settings'), onClick: () => { document.body.dataset.menu = ''; } }, ['Settings'])
  ]);
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const startDay = start.getDay();
  const daysInMonth = end.getDate();
  const grid = el('div', { class: 'grid' });
  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dowRow = dows.map(d => el('div', { class: 'dow' }, [d]));
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const [cal, users] = await Promise.all([API.get('/api/calendar').catch(() => ({})), API.get('/api/users').catch(() => [])]);
  storage.set('cache_users', users);
  const athletes = users.filter(u => (u.role || '').toLowerCase().includes('athlete'));
  const athleteFilter = el('select', { class: 'input' }, [el('option', { value: '' }, ['All Athletes'])].concat(athletes.map(a => el('option', { value: a.id }, [a.name]))));
  const filterRow = el('div', { class: 'row' }, [el('span', { class: 'muted' }, ['Filter athlete:']), athleteFilter]);
  const cellEls = cells.map((d) => {
    if (!d) return el('div', { class: 'day' }, []);
    const dayKey = `${year}-${month+1}-${d}`;
    const wrap = el('div', { class: 'day' }, [
      el('div', { class: 'date' }, [String(d)]),
      ...((cal[dayKey] || []).map((s) => {
        const name = s.userId ? (athletes.find(a => a.id === s.userId)?.name || '') : '';
        const meta = [];
        if (s.sessionType) meta.push(s.sessionType);
        if (s.duration) meta.push(String(s.duration) + 'm');
        const prefix = meta.length ? `[${meta.join(' ')}] ` : '';
        const label = prefix + (name ? `${s.name} — ${name}` : s.name);
        const sess = el('div', { class: 'session' + (s.done ? ' done' : '') }, [label]);
        sess.addEventListener('click', async () => {
          const notes = prompt('Notes', s.notes || '');
          const done = confirm('Mark as done? OK=yes, Cancel=no') ? true : s.done;
          await API.put(`/api/calendar/${s.id}`, { dayKey, notes, done });
          location.hash = '#/calendar';
        });
        return sess;
      }))
    ]);
    wrap.addEventListener('dblclick', async () => {
      const name = prompt('Add session name');
      if (!name) return;
      const userId = athleteFilter.value || '';
      const sessionType = prompt('Session type (Skill/Strength/Endurance/Recovery)', 'Skill') || 'Skill';
      const durationStr = prompt('Duration (minutes)', '60') || '0';
      const duration = Number(durationStr) || 0;
      await API.post('/api/calendar', { dayKey, name, userId, sessionType, duration });
      location.hash = '#/calendar';
    });
    return wrap;
  });
  dowRow.forEach(n => grid.appendChild(n));
  cellEls.forEach(n => grid.appendChild(n));
  const header = el('div', { class: 'month' }, [
    el('div', { class: 'row' }, [
      el('h3', {}, [now.toLocaleString(undefined, { month: 'long', year: 'numeric' })])
    ]),
    el('div', { class: 'row' }, [
      el('span', { class: 'muted' }, ['Double-click a day to add a session'])
    ])
  ]);
  const calendar = el('div', { class: 'calendar card' }, [header, filterRow, grid]);
  athleteFilter.addEventListener('change', () => {
    const id = athleteFilter.value;
    Array.from(grid.children).forEach((child) => {
      if (child.classList.contains('dow')) return;
      const spans = child.querySelectorAll('.session');
      spans.forEach((s) => {
        if (!id) { s.style.display = ''; return; }
        const txt = s.textContent || '';
        s.style.display = txt.includes(' — ') && txt.endsWith((athletes.find(a => a.id === id)?.name || '')) ? '' : 'none';
      });
    });
  });
  const content = el('section', { class: 'content' }, [
    el('div', { class: 'topbar' }, [el('div', { class: 'greet' }, ['Calendar'])]),
    calendar
  ]);
  return el('div', { class: 'layout' }, [sidebar, content]);
}

async function ProgrammingView() {
  const active = (route) => location.hash.includes(route) ? 'nav-link active' : 'nav-link';
  const sidebar = el('aside', { class: 'sidebar card' }, [
    el('div', { class: 'sidebar-header' }, ['Menu']),
    el('a', { href: '#/dashboard', class: active('/dashboard'), onClick: () => { document.body.dataset.menu = ''; } }, ['Overview']),
    el('a', { href: '#/calendar', class: active('/calendar'), onClick: () => { document.body.dataset.menu = ''; } }, ['Calendar']),
    el('a', { href: '#/programming', class: active('/programming'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programming']),
    el('a', { href: '#/analytics', class: active('/analytics'), onClick: () => { document.body.dataset.menu = ''; } }, ['Analytics']),
    el('a', { href: '#/users', class: active('/users'), onClick: () => { document.body.dataset.menu = ''; } }, ['Users']),
    el('a', { href: '#/products', class: active('/products'), onClick: () => { document.body.dataset.menu = ''; } }, ['Products']),
    el('a', { href: '#/profile', class: active('/profile'), onClick: () => { document.body.dataset.menu = ''; } }, ['Profile']),
    el('a', { href: '#/settings', class: active('/settings'), onClick: () => { document.body.dataset.menu = ''; } }, ['Settings'])
  ]);
  const [workouts, users] = await Promise.all([
    API.get('/api/workouts').catch(() => []),
    API.get('/api/users').catch(() => [])
  ]);
  storage.set('cache_users', users);
  storage.set('cache_workouts', workouts);
  const athletes = users.filter(u => (u.role || '').toLowerCase().includes('athlete'));
  const athleteFilter = el('select', { class: 'input' }, [el('option', { value: '' }, ['All Athletes'])].concat(athletes.map(a => el('option', { value: a.id }, [a.name]))));
  const table = el('table', { class: 'table' });
  const thead = el('thead', {}, [
    el('tr', {}, [
      el('th', {}, ['Name']),
      el('th', {}, ['Sets']),
      el('th', {}, ['Reps']),
      el('th', {}, ['Load']),
      el('th', {}, ['Type']),
      el('th', {}, ['Dur']),
      el('th', {}, ['RPE']),
      el('th', {}, ['Athlete']),
      el('th', {}, ['Actions'])
    ])
  ]);
  const tbody = el('tbody');
  const renderRows = (list) => {
    tbody.innerHTML = '';
    list.forEach((w) => {
    const tr = el('tr', {}, [
      el('td', {}, [w.name]),
      el('td', {}, [String(w.sets)]),
      el('td', {}, [String(w.reps)]),
        el('td', {}, [w.load || '-']),
        el('td', {}, [w.type || '']),
        el('td', {}, [w.duration ? String(w.duration) + 'm' : '-']),
        el('td', {}, [w.rpe ? String(w.rpe) : '-']),
        el('td', {}, [athletes.find(a => a.id === w.assignedTo)?.name || 'Unassigned']),
      el('td', {}, [
        el('button', { class: 'secondary', onClick: async () => {
          await API.del(`/api/workouts/${w.id}`);
          location.hash = '#/programming';
        } }, ['Remove'])
      ])
    ]);
    tbody.appendChild(tr);
    });
  };
  renderRows(workouts);
  athleteFilter.addEventListener('change', () => {
    const id = athleteFilter.value;
    const filtered = id ? workouts.filter(w => w.assignedTo === id) : workouts;
    renderRows(filtered);
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  const modal = el('div', { class: 'modal', id: 'addWorkout' }, [
    el('div', { class: 'panel' }, [
      el('h3', {}, ['Add Workout']),
      el('input', { class: 'input', placeholder: 'Exercise name', id: 'w_name' }),
      el('div', { class: 'row' }, [
        el('input', { class: 'input', placeholder: 'Sets', id: 'w_sets', type: 'number', min: '1' }),
        el('input', { class: 'input', placeholder: 'Reps', id: 'w_reps', type: 'number', min: '1' }),
        el('input', { class: 'input', placeholder: 'Load (kg)', id: 'w_load', type: 'number', min: '0' })
      ]),
      el('div', { class: 'row' }, [
        el('select', { class: 'input', id: 'w_type' }, ['Strength','Skill','Endurance','Recovery'].map(t => el('option', { value: t }, [t]))),
        el('input', { class: 'input', placeholder: 'Duration (min)', id: 'w_dur', type: 'number', min: '0' }),
        el('input', { class: 'input', placeholder: 'RPE (1-10)', id: 'w_rpe', type: 'number', min: '1', max: '10' }),
        el('input', { class: 'input', placeholder: 'Location', id: 'w_loc' })
      ]),
      el('div', { class: 'row' }, [
        el('span', { class: 'muted' }, ['Assign to:']),
        el('select', { class: 'input', id: 'w_user' }, [el('option', { value: '' }, ['Unassigned'])].concat(athletes.map(a => el('option', { value: a.id }, [a.name]))))
      ]),
      el('div', { class: 'actions' }, [
        el('button', { class: 'secondary', onClick: () => modal.classList.remove('show') }, ['Cancel']),
        el('button', { onClick: async () => {
          const name = document.getElementById('w_name').value.trim();
          const sets = Number(document.getElementById('w_sets').value);
          const reps = Number(document.getElementById('w_reps').value);
          const load = document.getElementById('w_load').value;
          const type = document.getElementById('w_type').value;
          const duration = Number(document.getElementById('w_dur').value || 0);
          const rpe = Number(document.getElementById('w_rpe').value || 0);
          const location = document.getElementById('w_loc').value;
          const assignedTo = document.getElementById('w_user').value;
          if (!name || !sets || !reps) return alert('Please fill the name/sets/reps');
          await API.post('/api/workouts', { name, sets, reps, load, type, duration, rpe, location, assignedTo });
          modal.classList.remove('show');
          location.hash = '#/programming';
        } }, ['Add'])
      ])
    ])
  ]);
  const addBtn = el('button', { onClick: () => modal.classList.add('show') }, ['Add Workout']);
  const exportBtn = el('button', { class: 'secondary', onClick: () => {
    const rows = [['Name','Sets','Reps','Load','Type','Duration','RPE','Athlete']].concat(workouts.map(w => [w.name,w.sets,w.reps,w.load||'', w.type||'', w.duration||'', w.rpe||'', athletes.find(a => a.id === w.assignedTo)?.name || 'Unassigned']));
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'workouts.csv'; a.click();
  } }, ['Export CSV']);
  const content = el('section', { class: 'content' }, [
    el('div', { class: 'topbar' }, [el('div', { class: 'greet' }, ['Programming']), athleteFilter, addBtn, exportBtn]),
    el('div', { class: 'card' }, [table]),
    modal
  ]);
  return el('div', { class: 'layout' }, [sidebar, content]);
}

async function UsersView() {
  const active = (route) => location.hash.includes(route) ? 'nav-link active' : 'nav-link';
  const sidebar = el('aside', { class: 'sidebar card' }, [
    el('div', { class: 'sidebar-header' }, ['Menu']),
    el('a', { href: '#/dashboard', class: active('/dashboard'), onClick: () => { document.body.dataset.menu = ''; } }, ['Overview']),
    el('a', { href: '#/calendar', class: active('/calendar'), onClick: () => { document.body.dataset.menu = ''; } }, ['Calendar']),
    el('a', { href: '#/programming', class: active('/programming'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programming']),
    el('a', { href: '#/programs', class: active('/programs'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programs']),
    el('a', { href: '#/analytics', class: active('/analytics'), onClick: () => { document.body.dataset.menu = ''; } }, ['Analytics']),
    el('a', { href: '#/users', class: active('/users'), onClick: () => { document.body.dataset.menu = ''; } }, ['Users']),
    el('a', { href: '#/products', class: active('/products'), onClick: () => { document.body.dataset.menu = ''; } }, ['Products']),
    el('a', { href: '#/profile', class: active('/profile'), onClick: () => { document.body.dataset.menu = ''; } }, ['Profile']),
    el('a', { href: '#/settings', class: active('/settings'), onClick: () => { document.body.dataset.menu = ''; } }, ['Settings'])
  ]);
  const users = await API.get('/api/users').catch(() => []);
  const teams = Array.from(new Set(users.map(u => u.team).filter(Boolean)));
  const table = el('table', { class: 'table' });
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', {}, ['Name']),
      el('th', {}, ['Role']),
      el('th', {}, ['Team']),
      el('th', {}, ['Category']),
      el('th', {}, ['Age']),
      el('th', {}, ['Tags']),
      el('th', {}, ['Status']),
      el('th', {}, ['Actions'])
    ])
  ]));
  const tbody = el('tbody');
  users.forEach((u) => {
    const tr = el('tr', {}, [
      el('td', {}, [u.name]),
      el('td', {}, [u.role]),
      el('td', {}, [u.team || '']),
      el('td', {}, [u.category || '']),
      el('td', {}, [u.ageGroup || '']),
      el('td', {}, [(u.tags || []).join(', ')]),
      el('td', {}, [u.status || 'active']),
      el('td', {}, [
        el('button', { class: 'secondary', onClick: async () => {
          await API.del(`/api/users/${u.id}`);
          location.hash = '#/users';
        } }, ['Remove'])
      ])
    ]);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  const nameI = el('input', { class: 'input', placeholder: 'Name' });
  const roleI = el('input', { class: 'input', placeholder: 'Role (athlete/coach)' });
  const teamI = el('input', { class: 'input', placeholder: 'Team (optional)' });
  const ageI = el('select', { class: 'input' }, ['U13','U15','U17','U19','Senior'].map(a => el('option', { value: a }, [a])));
  const catI = el('select', { class: 'input' }, ['Sprint','Endurance','Skill'].map(c => el('option', { value: c }, [c])));
  const tagsI = el('input', { class: 'input', placeholder: 'Tags (comma separated)' });
  const statusI = el('select', { class: 'input' }, ['active','inactive'].map(s => el('option', { value: s }, [s])));
  const filterTeam = el('select', { class: 'input' }, [el('option', { value: '' }, ['All Teams'])].concat(teams.map(t => el('option', { value: t }, [t]))));
  filterTeam.value = '';
  filterTeam.addEventListener('change', () => {
    const val = filterTeam.value;
    Array.from(tbody.children).forEach(tr => {
      const txt = tr.children[2].textContent || '';
      tr.style.display = (val === '' || txt === val) ? '' : 'none';
    });
  });
  const add = async () => {
    const name = nameI.value.trim(); const role = roleI.value.trim() || 'athlete'; const team = teamI.value.trim();
    if (!name) return;
    await API.post('/api/users', {
      name, role, team,
      ageGroup: ageI.value,
      category: catI.value,
      tags: tagsI.value,
      status: statusI.value
    });
    location.hash = '#/users';
  };
  const exportBtn = el('button', { class: 'secondary', onClick: () => {
    const rows = [['Name','Role','Team','Category','Age','Tags','Status']].concat(users.map(u => [u.name, u.role, u.team || '', u.category || '', u.ageGroup || '', (u.tags||[]).join('|'), u.status || 'active']));
    const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'users.csv'; a.click();
  } }, ['Export CSV']);
  const content = el('section', { class: 'content' }, [
    el('div', { class: 'topbar' }, [el('div', { class: 'greet' }, ['Users']), exportBtn]),
    el('div', { class: 'card' }, [
      el('div', { class: 'row' }, [nameI, roleI, teamI, ageI, catI, tagsI, statusI, el('button', { onClick: add }, ['Add User'])]),
      el('div', { class: 'row' }, [el('span', { class: 'muted' }, ['Filter by team: ']), filterTeam]),
      table
    ])
  ]);
  return el('div', { class: 'layout' }, [sidebar, content]);
}

function ProductsView() {
  const active = (route) => location.hash.includes(route) ? 'nav-link active' : 'nav-link';
  const sidebar = el('aside', { class: 'sidebar card' }, [
    el('div', { class: 'sidebar-header' }, ['Menu']),
    el('a', { href: '#/dashboard', class: active('/dashboard'), onClick: () => { document.body.dataset.menu = ''; } }, ['Overview']),
    el('a', { href: '#/calendar', class: active('/calendar'), onClick: () => { document.body.dataset.menu = ''; } }, ['Calendar']),
    el('a', { href: '#/programming', class: active('/programming'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programming']),
    el('a', { href: '#/programs', class: active('/programs'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programs']),
    el('a', { href: '#/analytics', class: active('/analytics'), onClick: () => { document.body.dataset.menu = ''; } }, ['Analytics']),
    el('a', { href: '#/users', class: active('/users'), onClick: () => { document.body.dataset.menu = ''; } }, ['Users']),
    el('a', { href: '#/products', class: active('/products'), onClick: () => { document.body.dataset.menu = ''; } }, ['Products']),
    el('a', { href: '#/profile', class: active('/profile'), onClick: () => { document.body.dataset.menu = ''; } }, ['Profile']),
    el('a', { href: '#/settings', class: active('/settings'), onClick: () => { document.body.dataset.menu = ''; } }, ['Settings'])
  ]);
  const products = [
    { name: 'Team Plan', price: '$99/mo' },
    { name: 'Coach Pro', price: '$49/mo' },
    { name: 'Athlete Basic', price: '$9/mo' }
  ];
  const list = el('div', { class: 'list' }, products.map(p =>
    el('div', { class: 'list-item' }, [el('span', {}, [p.name]), el('span', { class: 'pill' }, [p.price])])
  ));
  const content = el('section', { class: 'content' }, [
    el('div', { class: 'topbar' }, [el('div', { class: 'greet' }, ['Products'])]),
    el('div', { class: 'card' }, [list])
  ]);
  return el('div', { class: 'layout' }, [sidebar, content]);
}

function ProfileView() {
  const active = (route) => location.hash.includes(route) ? 'nav-link active' : 'nav-link';
  const sidebar = el('aside', { class: 'sidebar card' }, [
    el('div', { class: 'sidebar-header' }, ['Menu']),
    el('a', { href: '#/dashboard', class: active('/dashboard'), onClick: () => { document.body.dataset.menu = ''; } }, ['Overview']),
    el('a', { href: '#/calendar', class: active('/calendar'), onClick: () => { document.body.dataset.menu = ''; } }, ['Calendar']),
    el('a', { href: '#/programming', class: active('/programming'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programming']),
    el('a', { href: '#/programs', class: active('/programs'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programs']),
    el('a', { href: '#/analytics', class: active('/analytics'), onClick: () => { document.body.dataset.menu = ''; } }, ['Analytics']),
    el('a', { href: '#/users', class: active('/users'), onClick: () => { document.body.dataset.menu = ''; } }, ['Users']),
    el('a', { href: '#/products', class: active('/products'), onClick: () => { document.body.dataset.menu = ''; } }, ['Products']),
    el('a', { href: '#/profile', class: active('/profile'), onClick: () => { document.body.dataset.menu = ''; } }, ['Profile']),
    el('a', { href: '#/settings', class: active('/settings'), onClick: () => { document.body.dataset.menu = ''; } }, ['Settings'])
  ]);
  const u = auth.user();
  const profile = storage.get('profile', { displayName: u?.username || 'User' });
  const info = el('div', { class: 'card' }, [
    el('h3', {}, ['Profile']),
    el('div', { class: 'row' }, [
      el('span', {}, ['Display Name: ']),
      el('span', { class: 'pill' }, [profile.displayName])
    ]),
    el('div', { class: 'row' }, [
      el('span', {}, ['Username: ']),
      el('span', { class: 'pill' }, [u?.username || '—'])
    ])
  ]);
  const content = el('section', { class: 'content' }, [
    el('div', { class: 'topbar' }, [el('div', { class: 'greet' }, ['Profile'])]),
    info
  ]);
  return el('div', { class: 'layout' }, [sidebar, content]);
}
function SettingsView() {
  const active = (route) => location.hash.includes(route) ? 'nav-link active' : 'nav-link';
  const sidebar = el('aside', { class: 'sidebar card' }, [
    el('div', { class: 'sidebar-header' }, ['Menu']),
    el('a', { href: '#/dashboard', class: active('/dashboard'), onClick: () => { document.body.dataset.menu = ''; } }, ['Overview']),
    el('a', { href: '#/calendar', class: active('/calendar'), onClick: () => { document.body.dataset.menu = ''; } }, ['Calendar']),
    el('a', { href: '#/programming', class: active('/programming'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programming']),
    el('a', { href: '#/programs', class: active('/programs'), onClick: () => { document.body.dataset.menu = ''; } }, ['Programs']),
    el('a', { href: '#/analytics', class: active('/analytics'), onClick: () => { document.body.dataset.menu = ''; } }, ['Analytics']),
    el('a', { href: '#/users', class: active('/users'), onClick: () => { document.body.dataset.menu = ''; } }, ['Users']),
    el('a', { href: '#/products', class: active('/products'), onClick: () => { document.body.dataset.menu = ''; } }, ['Products']),
    el('a', { href: '#/profile', class: active('/profile'), onClick: () => { document.body.dataset.menu = ''; } }, ['Profile']),
    el('a', { href: '#/settings', class: active('/settings'), onClick: () => { document.body.dataset.menu = ''; } }, ['Settings'])
  ]);
  const profile = storage.get('profile', { displayName: auth.user()?.username || 'User' });
  const nameInput = el('input', { class: 'input', value: profile.displayName, placeholder: 'Display name' });
  const save = () => {
    const displayName = nameInput.value.trim() || 'User';
    storage.set('profile', { displayName });
    location.hash = '#/dashboard';
  };
  const pane = el('div', { class: 'card' }, [
    el('h3', {}, ['Profile']),
    el('div', { class: 'row' }, [nameInput, el('button', { onClick: save }, ['Save'])])
  ]);
  const apiBaseInput = el('input', { class: 'input', value: storage.get('api_base', ''), placeholder: 'API base URL (optional)' });
  const apiSave = () => { storage.set('api_base', apiBaseInput.value.trim()); alert('API base saved'); };
  const apiClear = () => { storage.set('api_base', ''); alert('Using local mock API'); };
  const apiPane = el('div', { class: 'card' }, [
    el('h3', {}, ['API']),
    el('div', { class: 'row' }, [apiBaseInput, el('button', { onClick: apiSave }, ['Save Base']), el('button', { class: 'secondary', onClick: apiClear }, ['Use Local Mock'])]),
    el('div', { class: 'muted' }, ['Set an absolute base URL to use a real backend; leave empty for local mock API.'])
  ]);
  const dataExport = el('button', { onClick: async () => {
    const data = await API.get('/api/dump').catch(() => null);
    if (!data) return alert('Export failed');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
    a.href = URL.createObjectURL(blob);
    a.download = `bmxapg-backup-${ts}.json`;
    a.click();
  } }, ['Export Data']);
  const dataImport = (() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      const text = await f.text();
      try {
        const obj = JSON.parse(text);
        await API.post('/api/restore', obj);
        alert('Import completed');
      } catch {
        alert('Invalid file');
      }
    });
    return el('button', { class: 'secondary', onClick: () => input.click() }, ['Import Data']);
  })();
  const dataReset = el('button', { class: 'secondary', onClick: async () => {
    await API.post('/api/restore', { users: [], workouts: [], calendar: {}, programs: [] });
    alert('Data reset');
  } }, ['Reset Data']);
  const dataPane = el('div', { class: 'card' }, [
    el('h3', {}, ['Data']),
    el('div', { class: 'row' }, [dataExport, dataImport, dataReset]),
    el('div', { class: 'muted' }, ['Export, import, or reset your local data.'])
  ]);
  const themePane = el('div', { class: 'card' }, [
    el('h3', {}, ['Theme']),
    el('div', { class: 'row' }, [el('button', { class: 'secondary', onClick: theme.toggle }, ['Toggle Theme'])])
  ]);
  const adminPane = (() => {
    const u = auth.user();
    if (u?.role !== 'admin') return null;
    return el('div', { class: 'card' }, [
      el('h3', {}, ['Admin Tools']),
      el('div', { class: 'row' }, [
        el('span', { class: 'badge warn' }, ['Role: admin']),
        el('button', { class: 'secondary', onClick: () => alert('Admin action executed') }, ['Run Maintenance'])
      ])
    ]);
  })();
  const content = el('section', { class: 'content' }, [
    el('div', { class: 'topbar' }, [el('div', { class: 'greet' }, ['Settings'])]),
    pane,
    apiPane,
    dataPane,
    themePane,
    adminPane
  ]);
  return el('div', { class: 'layout' }, [sidebar, content]);
}
function NotFoundView() {
  const link = auth.isAuthed() ? '#/dashboard' : '#/login';
  return el('section', { class: 'auth' }, [
    el('div', { class: 'auth-form' }, [
      el('h2', {}, ['Not Found']),
      el('div', { class: 'muted' }, ['The page you requested does not exist.']),
      el('a', { href: link, class: 'secondary' }, ['Go Home'])
    ])
  ]);
}
async function renderRoute() {
  headerActions();
  const path = location.hash.replace(/^#/, '') || '/dashboard';
  const overlay = el('div', { class: 'route-loading' }, [el('div', { class: 'spinner' })]);
  document.body.appendChild(overlay);
  app.innerHTML = '';
  if (path.startsWith('/dashboard')) {
    if (!auth.isAuthed()) { location.hash = '#/login'; return; }
    app.appendChild(DashboardView());
  } else if (path.startsWith('/calendar')) {
    if (!auth.isAuthed()) { location.hash = '#/login'; return; }
    app.appendChild(await CalendarView());
  } else if (path.startsWith('/programming')) {
    if (!auth.isAuthed()) { location.hash = '#/login'; return; }
    app.appendChild(await ProgrammingView());
  } else if (path.startsWith('/analytics')) {
    if (!auth.isAuthed()) { location.hash = '#/login'; return; }
    app.appendChild(AnalyticsView());
  } else if (path.startsWith('/programs')) {
    if (!auth.isAuthed()) { location.hash = '#/login'; return; }
    app.appendChild(await ProgramsView());
  } else if (path.startsWith('/users')) {
    if (!auth.isAuthed()) { location.hash = '#/login'; return; }
    app.appendChild(await UsersView());
  } else if (path.startsWith('/products')) {
    if (!auth.isAuthed()) { location.hash = '#/login'; return; }
    app.appendChild(ProductsView());
  } else if (path.startsWith('/profile')) {
    if (!auth.isAuthed()) { location.hash = '#/login'; return; }
    app.appendChild(ProfileView());
  } else if (path.startsWith('/settings')) {
    if (!auth.isAuthed()) { location.hash = '#/login'; return; }
    app.appendChild(SettingsView());
  } else if (path.startsWith('/login')) {
    if (auth.isAuthed()) { location.hash = '#/dashboard'; return; }
    app.appendChild(LoginView());
  } else {
    app.appendChild(NotFoundView());
  }
  setTimeout(() => document.body.removeChild(overlay), 200);
}
async function seedDemoIfEmpty() {
  if (storage.get('demo_seeded', false)) return;
  const dump = await API.get('/api/dump').catch(() => null);
  if (!dump) return;
  const empty = (dump.users || []).length === 0 && (dump.workouts || []).length === 0 && (dump.programs || []).length === 0;
  if (!empty) return;
  const a1 = await API.post('/api/users', { name: 'Rider A', role: 'athlete', team: 'BMX APG', ageGroup: 'U17', category: 'Sprint', tags: 'gate,start', status: 'active' });
  const a2 = await API.post('/api/users', { name: 'Rider B', role: 'athlete', team: 'BMX APG', ageGroup: 'U19', category: 'Endurance', tags: 'lap,flow', status: 'active' });
  await API.post('/api/workouts', { name: 'Gate Starts', sets: 5, reps: 3, load: '', type: 'Skill', duration: 30, rpe: 6, location: 'Track', assignedTo: a1.id });
  await API.post('/api/workouts', { name: 'Strength Squats', sets: 4, reps: 6, load: '80kg', type: 'Strength', duration: 40, rpe: 8, location: 'Gym', assignedTo: a1.id });
  await API.post('/api/workouts', { name: 'Endurance Laps', sets: 3, reps: 5, load: '', type: 'Endurance', duration: 50, rpe: 7, location: 'Track', assignedTo: a2.id });
  const today = new Date();
  const iso = today.toISOString().slice(0, 10);
  await API.post('/api/calendar', { dayKey: `${today.getFullYear()}-${today.getMonth()+1}-${today.getDate()}`, name: 'Track Session', userId: a1.id, sessionType: 'Skill', duration: 60 });
  const prog = await API.post('/api/programs', { name: 'Base Week', athleteId: a2.id, steps: [{ offset: 0, name: 'Endurance Laps' }, { offset: 2, name: 'Recovery Roll' }, { offset: 4, name: 'Skill Drills' }] });
  await API.post(`/api/programs/${prog.id}/apply?start=${encodeURIComponent(iso)}`, {});
  storage.set('demo_seeded', true);
}

async function start() {
  theme.init();
  window.addEventListener('hashchange', renderRoute);
  document.addEventListener('click', (e) => {
    const open = document.body.dataset.menu === 'open';
    if (!open) return;
    const sidebar = document.querySelector('.sidebar');
    const btn = document.querySelector('.menu-btn');
    const within = sidebar && sidebar.contains(e.target);
    const onBtn = btn && btn.contains(e.target);
    if (!within && !onBtn) document.body.dataset.menu = '';
  });
  const base = storage.get('api_base', '');
  if (base && /portal\.rypt\.app/i.test(base)) {
    storage.del('api_base');
  }
  if (!location.hash) location.hash = auth.isAuthed() ? '#/dashboard' : '#/login';
  await seedDemoIfEmpty();
  renderRoute();
}

start();
