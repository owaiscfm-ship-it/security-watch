/* SecureWatch — Supabase backend (REST, no extra libraries)
 * Every record is stored in one table, public.records (store, id, site_id, guard_id, data).
 * Row Level Security on the server decides who can read or write each row.
 * The browser keeps a local copy in IndexedDB so the guard app keeps working offline.
 */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util;
  const C = window.SW_CONFIG || {};
  const AUTH_KEY = 'sw_sb_auth';
  const CURSOR_KEY = 'sw_sb_cursor';
  const LAST_USER_KEY = 'sw_sb_last_user';

  const R = (SW.remote = {
    enabled: !!(C.supabaseUrl && C.supabaseKey && !/PASTE/.test(C.supabaseKey)),
    misconfigured: !!(C.supabaseUrl && (!C.supabaseKey || /PASTE/.test(C.supabaseKey))),
    url: (C.supabaseUrl || '').replace(/\/$/, ''),
    key: C.supabaseKey || '',
    domain: C.loginDomain || 'cfm-securewatch.local',
    lastSync: null,
    lastError: null,
    syncing: false,
  });

  /* ---------- token handling ---------- */
  function loadAuth() { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (_) { return null; } }
  function saveAuth(a) { if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a)); else localStorage.removeItem(AUTH_KEY); }
  R.hasTokens = () => !!loadAuth();

  async function authCall(path, body, token) {
    const res = await fetch(R.url + '/auth/v1/' + path, {
      method: 'POST',
      headers: Object.assign({ apikey: R.key, 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error_description || data.msg || data.message || 'Sign-in failed'); e.status = res.status; throw e; }
    return data;
  }
  function store(t) {
    saveAuth({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000, user_id: t.user && t.user.id });
  }
  let refreshing = null;
  R.token = async function () {
    const a = loadAuth();
    if (!a) throw Object.assign(new Error('Not signed in'), { status: 401 });
    if (Date.now() < a.expires_at - 60000) return a.access_token;
    if (!refreshing) {
      refreshing = authCall('token?grant_type=refresh_token', { refresh_token: a.refresh_token })
        .then((t) => { store(t); return t.access_token; })
        .catch((e) => { if (e.status === 400 || e.status === 401) { saveAuth(null); if (SW.app) SW.app.sessionExpired(); } throw e; })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  };

  async function api(path, opts) {
    opts = opts || {};
    const token = await R.token();
    const res = await fetch(R.url + '/rest/v1/' + path, {
      method: opts.method || 'GET',
      headers: Object.assign({ apikey: R.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, opts.headers || {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      const t = await res.json().catch(() => ({}));
      const e = new Error(t.message || t.hint || ('Server error ' + res.status)); e.status = res.status; throw e;
    }
    if (res.status === 204) return null;
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }
  R.rpc = (name, args) => api('rpc/' + name, { method: 'POST', body: args || {} });

  /* ---------- sign in / out ---------- */
  R.login = async function (username, password) {
    let email = username.includes('@') ? username : username + '@' + R.domain;
    if (username.includes('@') && !username.endsWith('@' + R.domain) && navigator.onLine) {
      // signing in with an email address: find the SecureWatch username for it
      try { const u = await anonRpc('sw_username_for_email', { p_email: username }); if (u) email = u + '@' + R.domain; } catch (_) { /* fall back to the email itself */ }
    }
    let t;
    try { t = await authCall('token?grant_type=password', { email, password }); }
    catch (e) {
      if (!navigator.onLine) throw new Error('You need internet the first time you sign in on this device.');
      throw new Error(e.status === 400 ? 'Username or password is incorrect.' : e.message);
    }
    store(t);
    const p = await R.rpc('sw_my_profile');
    if (!p || !p.role) { saveAuth(null); throw new Error('This login has no SecureWatch profile. Ask your manager.'); }
    if (p.role === 'pending') { await R.logout(); throw new Error('Your account is waiting for a manager to approve it. You will get an email when it is ready.'); }
    // a different person on this device: clear the previous person's cached data
    const last = localStorage.getItem(LAST_USER_KEY);
    if (last && last !== p.user_id) { await SW.db.clearAll(); localStorage.removeItem(CURSOR_KEY); }
    localStorage.setItem(LAST_USER_KEY, p.user_id);
    return p;
  };
  R.logout = async function () {
    const a = loadAuth();
    if (a && navigator.onLine) { try { await authCall('logout', {}, a.access_token); } catch (_) { /* ignore */ } }
    saveAuth(null);
  };

  /* ---------- IDs that must be unique across devices ---------- */
  R.nextId = async function (prefix) {
    if (navigator.onLine) {
      try { const id = await R.rpc('sw_next_id', { p_prefix: prefix }); if (id) return id; } catch (_) { /* fall back */ }
    }
    return prefix + '-T' + U.token(5); // offline: temporary but unique
  };

  /* ---------- push local changes ---------- */
  const LOCAL_ONLY = new Set(['syncQueue', 'users']);
  R.LOCAL_ONLY = LOCAL_ONLY;
  function row(store, rec, deleted) {
    let site = rec.siteId || null, guard = rec.guardId || null;
    if (store === 'sites') site = rec.id;
    if (store === 'guards') guard = rec.id;
    return { store, id: rec.id, site_id: site, guard_id: guard, data: rec, deleted: !!deleted };
  }
  R.push = async function (items) {
    const done = [];
    const rows = [];
    for (const q of items) {
      if (q.op === 'delete') rows.push({ q, r: row(q.store, Object.assign({ id: q.recordId }, q.snapshot || {}), true) });
      else {
        const rec = SW.db.get(q.store, q.recordId);
        if (!rec) { done.push(q.id); continue; }
        rows.push({ q, r: row(q.store, rec, false) });
      }
    }
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      try {
        await api('records?on_conflict=store,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: batch.map((b) => b.r) });
        batch.forEach((b) => done.push(b.q.id));
      } catch (e) {
        if (e.status === 401) throw e;
        // one bad row should not block the rest: retry one by one, drop rows the server refuses
        for (const b of batch) {
          try { await api('records?on_conflict=store,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: [b.r] }); done.push(b.q.id); }
          catch (e2) { if (e2.status >= 400 && e2.status < 500 && e2.status !== 401) { console.warn('Server refused', b.r.store, b.r.id, e2.message); done.push(b.q.id); } else throw e2; }
        }
      }
    }
    return done;
  };

  /* ---------- pull server changes ---------- */
  R.pull = async function () {
    const pendingKeys = new Set(SW.db.pending().map((q) => q.store + '|' + q.recordId));
    let cursor = localStorage.getItem(CURSOR_KEY);
    let changed = 0, max = cursor;
    for (let page = 0; page < 50; page++) {
      // re-read a 2-minute overlap so slow transactions are never missed
      const since = cursor ? new Date(new Date(cursor).getTime() - 120000).toISOString() : null;
      const q = 'records?select=store,id,data,deleted,updated_at&order=updated_at.asc,id.asc&limit=1000' + (since ? '&updated_at=gt.' + encodeURIComponent(since) : '') + '&offset=' + page * 1000;
      const rows = await api(q);
      for (const r of rows) {
        if (!SW.db.STORES.includes(r.store) || LOCAL_ONLY.has(r.store)) continue;
        if (pendingKeys.has(r.store + '|' + r.id)) continue; // local edit not uploaded yet wins
        const cur = SW.db.get(r.store, r.id);
        if (r.deleted) { if (cur) { await SW.db.removeRaw(r.store, r.id); changed++; } }
        else if (!cur || JSON.stringify(cur) !== JSON.stringify(r.data)) { await SW.db.putRaw(r.store, r.data); changed++; }
        if (!max || r.updated_at > max) max = r.updated_at;
      }
      if (rows.length < 1000) break;
    }
    if (max) localStorage.setItem(CURSOR_KEY, max);
    if (SW.session && SW.session.role === 'client') {
      const set = SW.db.settings();
      const hidden = (set.clientHidden || []).concat(set.clientView && set.clientView.guardNames === false ? ['guards'] : []);
      for (const st of hidden) for (const r of SW.db.all(st).slice()) { await SW.db.removeRaw(st, r.id); changed++; }
      if (set.clientView && set.clientView.guardNames === false) return changed;
      try {
        const names = await R.rpc('sw_guard_names');
        for (const g of names || []) if (!SW.db.get('guards', g.id)) { await SW.db.putRaw('guards', { id: g.id, name: g.name, status: 'Active' }); changed++; }
      } catch (_) { /* names are cosmetic */ }
    }
    return changed;
  };
  R.resetCursor = () => localStorage.removeItem(CURSOR_KEY);

  /* ---------- one sync round ---------- */
  R.sync = async function () {
    if (!R.enabled || !SW.session || !navigator.onLine || R.syncing) return 0;
    R.syncing = true;
    try {
      if (SW.db.pending().length) await SW.ops.processSync();
      const n = await R.pull();
      R.lastSync = new Date(); R.lastError = null;
      return n;
    } catch (e) {
      R.lastError = e.message;
      return 0;
    } finally { R.syncing = false; }
  };

  /* ---------- login management (managers) ---------- */
  R.listLogins = () => R.rpc('sw_list_logins');
  R.createLogin = (a) => R.rpc('sw_create_login', a);
  R.setPassword = (username, password, notify) => R.rpc('sw_set_password', { p_username: username, p_password: password, p_notify: !!notify });
  R.setEmail = (username, email) => R.rpc('sw_set_email', { p_username: username, p_email: email || '' });
  R.deleteLogin = (username) => R.rpc('sw_delete_login', { p_username: username });
  R.mailSettings = () => R.rpc('sw_mail_settings');
  R.saveMailSettings = (emails, url) => R.rpc('sw_save_mail_settings', { p_alert_emails: emails, p_app_url: url });
  R.sendTestMail = () => R.rpc('sw_send_test_mail');

  /* checks a password without changing the current sign-in */
  R.checkPassword = async function (username, password) {
    const email = username.includes('@') ? username : username + '@' + R.domain;
    try { await authCall('token?grant_type=password', { email, password }); return true; } catch (e) { return false; }
  };

  /* ---------- forgot password (no sign-in needed) ---------- */
  async function anonRpc(name, args) {
    const h = { apikey: R.key, 'Content-Type': 'application/json' };
    if (/^eyJ/.test(R.key)) h.Authorization = 'Bearer ' + R.key; // legacy anon keys
    const res = await fetch(R.url + '/rest/v1/rpc/' + name, { method: 'POST', headers: h, body: JSON.stringify(args || {}) });
    const t = await res.json().catch(() => null);
    if (!res.ok) throw new Error((t && (t.message || t.hint)) || ('Server error ' + res.status));
    return t;
  }
  R.signup = (a) => anonRpc('sw_signup', a);
  R.pendingSignups = () => R.rpc('sw_pending');
  R.approveSignup = (username, role, guard, sites) => R.rpc('sw_approve', { p_username: username, p_role: role, p_guard: guard || null, p_sites: sites || [] });
  R.rejectSignup = (username) => R.rpc('sw_reject', { p_username: username });
  R.requestReset = (username) => anonRpc('sw_request_reset', { p_username: username });
  R.resetWithCode = (username, code, password) => anonRpc('sw_reset_with_code', { p_username: username, p_code: code, p_password: password });

  if (R.enabled) SW.syncAdapter = { name: 'SecureWatch server (Supabase, London)', remote: true, push: R.push };
})();
