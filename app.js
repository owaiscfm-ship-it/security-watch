/* SecureWatch — application bootstrap and router */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util, db = SW.db;
  const esc = U.esc;
  const root = () => document.getElementById('app');
  let mounted = null;

  const app = (SW.app = {});

  /* ---------------- Boot ---------------- */
  app.boot = async function () {
    try {
      await db.init();
      if (!db.get('settings', 'app')) await SW.demo.seed(); // first run: load demo so the app is never empty
      await SW.auth.ensureDemoUsers();
      SW.auth.restore();
    } catch (e) {
      root().innerHTML = '<div class="fatal"><h1>SecureWatch could not start</h1><p>' + esc(e.message) + '</p><p>Try closing other SecureWatch tabs, or use a browser that allows site storage.</p></div>';
      return;
    }
    window.addEventListener('hashchange', app.route);
    window.addEventListener('online', onNet);
    window.addEventListener('offline', onNet);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && SW.guard && mounted === 'guard') SW.guard.checkWelfare(); });
    app.route();
    if (navigator.onLine && db.pending().length) app.sync();
    registerSW();
  };

  /* ---------------- Router ---------------- */
  app.route = function () {
    const hash = location.hash.replace(/^#\/?/, '');
    const [area, view] = hash.split('/');
    const s = SW.session;
    if (!s) return show('login');
    const home = { guard: 'guard', manager: 'manager', client: 'client' }[s.role];
    if (area !== home) { location.replace('#/' + home + (home === 'manager' ? '/dashboard' : '')); return show(home, home === 'manager' ? 'dashboard' : null); }
    show(home, view);
  };

  function show(area, view) {
    if (mounted === 'manager' && area === 'manager' && SW.manager.view !== view && view) { SW.manager.view = view; SW.manager.render(); return; }
    if (mounted === area && area !== 'login') return;
    if (mounted === 'guard') SW.guard.unmount();
    if (mounted === 'manager') SW.manager.unmount();
    mounted = area;
    document.body.className = 'area-' + area;
    const el = root();
    if (area === 'login') { document.title = 'Sign in — SecureWatch'; renderLogin(el); }
    else if (area === 'guard') { document.title = 'SecureWatch — Guard'; SW.guard.mount(el); }
    else if (area === 'manager') SW.manager.mount(el, view || 'dashboard');
    else if (area === 'client') { document.title = 'SecureWatch — Client portal'; SW.client.mount(el); }
  }

  app.logout = async function () {
    await SW.auth.logout();
    location.hash = '#/login';
    mounted = null;
    app.route();
  };

  /* ---------------- Login ---------------- */
  function renderLogin(el) {
    const role = sessionStorage.getItem('sw_role') || 'guard';
    el.innerHTML =
      '<div class="login">' +
      '<section class="login-side"><div class="m-brand big"><span class="logo-mark" aria-hidden="true"></span><div><strong>SecureWatch</strong><small>Security Operations &amp; Patrol Management</small></div></div>' +
      '<p class="login-copy">Patrol checkpoints, incidents, welfare checks and daily reports for SIA-licensed officers.</p>' +
      '<ul class="login-points"><li>Guard app works offline inside buildings</li><li>QR checkpoint scanning with GPS capture</li><li>Printable daily security reports</li></ul></section>' +
      '<section class="login-main"><form id="login-form" class="login-card" novalidate>' +
      '<h1>Sign in</h1>' +
      '<div class="seg seg-role" role="radiogroup" aria-label="Sign in as">' +
      ['guard', 'manager', 'client'].map((r) => '<label><input type="radio" name="role" value="' + r + '"' + (r === role ? ' checked' : '') + '><span>' + r[0].toUpperCase() + r.slice(1) + '</span></label>').join('') + '</div>' +
      '<label class="fld"><span>Username</span><input name="username" autocomplete="username" autocapitalize="none" maxlength="40" required></label>' +
      '<label class="fld"><span>Password</span><input name="password" type="password" autocomplete="current-password" maxlength="100" required></label>' +
      '<p class="login-err" id="login-err" role="alert"></p>' +
      '<button class="btn btn-primary btn-block btn-lg" id="login-btn">Sign in</button>' +
      '<div class="demo-creds"><p><b>Demo credentials</b> — for demonstration only, not secure authentication.</p>' +
      '<div class="demo-row">' + SW.auth.DEMO.map((d) => '<button type="button" class="btn btn-sm btn-secondary" data-demo="' + d.username + '">' + d.role[0].toUpperCase() + d.role.slice(1) + ': ' + d.username + ' / ' + d.password + '</button>').join('') + '</div></div>' +
      '<p class="login-foot"><a href="#" id="privacy-link">Privacy notice</a> — Prototype: data is stored only in this browser.</p>' +
      '</form></section></div>';
    const f = U.$('#login-form');
    f.querySelectorAll('[data-demo]').forEach((b) => (b.onclick = () => {
      const d = SW.auth.DEMO.find((x) => x.username === b.dataset.demo);
      f.username.value = d.username; f.password.value = d.password;
      f.querySelector('[name=role][value=' + d.role + ']').checked = true;
      f.requestSubmit ? f.requestSubmit() : f.dispatchEvent(new Event('submit', { cancelable: true }));
    }));
    U.$('#privacy-link').onclick = (e) => { e.preventDefault(); U.modal({ title: 'Privacy notice', body: app.privacyHtml(), wide: true, actions: [{ label: 'Close', cls: 'btn-primary' }] }); };
    f.onsubmit = async (e) => {
      e.preventDefault();
      const err = U.$('#login-err');
      const r = f.querySelector('[name=role]:checked').value;
      sessionStorage.setItem('sw_role', r);
      if (!f.username.value || !f.password.value) { err.textContent = 'Enter your username and password.'; return; }
      const btn = U.$('#login-btn'); btn.disabled = true; btn.textContent = 'Signing in…';
      const res = await SW.auth.login(f.username.value, f.password.value, r);
      if (!res.ok) { err.textContent = res.error; btn.disabled = false; btn.textContent = 'Sign in'; return; }
      mounted = null;
      location.hash = '#/' + res.session.role + (res.session.role === 'manager' ? '/dashboard' : '');
      app.route();
    };
  }

  /* ---------------- Online / offline + sync ---------------- */
  function onNet() {
    if (SW.guard && mounted === 'guard') SW.guard.updateChips();
    const n = document.getElementById('m-net');
    if (n) { n.className = 'chip ' + (navigator.onLine ? 'chip-ok' : 'chip-bad'); n.innerHTML = '<i></i>' + (navigator.onLine ? 'Online' : 'Offline'); }
    if (!navigator.onLine) U.toast('You are offline. Records are saved on this phone and will sync when signal returns.', 'info', 5000);
    else if (db.pending().length) app.sync();
  }
  let syncing = false;
  app.sync = async function () {
    if (syncing) return;
    syncing = true;
    const bar = document.createElement('div');
    bar.className = 'sync-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span class="spinner sm"></span><b>Syncing data…</b><span>' + db.pending().length + ' record(s) saved offline</span>';
    document.body.appendChild(bar);
    try {
      const n = await SW.ops.processSync();
      bar.classList.add('done');
      bar.innerHTML = '<b>All data synced</b><span>' + n + ' record(s). ' + (SW.syncAdapter.remote ? 'Uploaded to ' + esc(SW.syncAdapter.name) + '.' : 'Saved on this device — no server is connected, so nothing was uploaded.') + '</span>';
    } catch (e) {
      bar.classList.add('fail');
      bar.innerHTML = '<b>Sync failed</b><span>' + esc(e.message) + '. Records remain saved on this device.</span>';
    }
    setTimeout(() => bar.remove(), 5000);
    syncing = false;
  };

  /* ---------------- Backup export / import ---------------- */
  const blobToDataUrl = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  app.exportBackup = async function (guardOnly) {
    const out = { app: 'SecureWatch', version: 1, exportedAt: new Date().toISOString(), exportedBy: SW.session ? SW.session.displayName : '', scope: guardOnly ? 'guard' : 'full', stores: {}, media: [] };
    const skip = ['users', 'syncQueue'];
    db.STORES.forEach((s) => {
      if (skip.includes(s)) return;
      let rows = db.all(s);
      if (guardOnly && SW.session.guardId && ['attendance', 'patrols', 'checkpointScans', 'incidents', 'welfareChecks', 'sosEvents', 'instructionAcks', 'shifts'].includes(s)) rows = rows.filter((r) => r.guardId === SW.session.guardId);
      if (guardOnly && ['auditLogs'].includes(s)) rows = rows.filter((r) => r.user === SW.session.displayName);
      if (guardOnly && ['guards', 'settings', 'sites', 'patrolRoutes', 'checkpoints', 'siteInstructions'].includes(s)) return;
      out.stores[s] = rows;
    });
    const incs = out.stores.incidents || [];
    let size = 0;
    for (const i of incs) for (const m of i.media || []) {
      const rec = await db.getMedia(m.id);
      if (rec && size + rec.size < 80 * 1048576) { size += rec.size; out.media.push({ id: rec.id, kind: rec.kind, name: rec.name, incidentId: rec.incidentId, data: await blobToDataUrl(rec.blob) }); }
    }
    const name = 'securewatch-' + (guardOnly ? 'guard-' + (SW.session.username || 'data') : 'backup') + '-' + U.today() + '.json';
    const file = new File([JSON.stringify(out)], name, { type: 'application/json' });
    await db.audit('Data exported', { subject: guardOnly ? 'Guard records' : 'Full backup' });
    if (guardOnly && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'SecureWatch data', text: 'SecureWatch records from ' + SW.session.displayName }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    U.download(name, file);
    U.toast('Data file downloaded' + (guardOnly ? '. Send it to your manager to import.' : ''), 'ok', 5000);
  };

  app.importBackup = async function (file) {
    if (!file) return;
    if (file.size > 200 * 1048576) return U.toast('That file is too large to import.', 'error');
    let data;
    try { data = JSON.parse(await file.text()); } catch (_) { return U.toast('That is not a valid SecureWatch data file.', 'error'); }
    if (!data || data.app !== 'SecureWatch' || typeof data.stores !== 'object') return U.toast('That is not a SecureWatch data file.', 'error');
    const counts = Object.keys(data.stores).filter((s) => db.STORES.includes(s) && s !== 'users').map((s) => (data.stores[s] || []).length + ' ' + s);
    const ok = await U.confirm('Import data?', 'Merge ' + counts.join(', ') + ' and ' + (data.media || []).length + ' media file(s) from ' + (data.exportedBy || 'unknown') + ' (' + U.fmtDateTime(data.exportedAt) + ')?', 'Import');
    if (!ok) return;
    let n = 0;
    for (const s of Object.keys(data.stores)) {
      if (!db.STORES.includes(s) || s === 'users' || s === 'syncQueue') continue;
      for (const r of data.stores[s]) { if (r && typeof r.id === 'string' && r.id.length < 120) { await db.put(s, r); n++; } }
    }
    for (const m of data.media || []) {
      try { const blob = await (await fetch(m.data)).blob(); await db.putMedia(blob, { id: m.id, kind: m.kind, name: m.name, incidentId: m.incidentId }); } catch (_) { /* skip bad media */ }
    }
    await db.audit('Data imported', { subject: n + ' records from ' + (data.exportedBy || 'file') });
    U.toast('Imported ' + n + ' records', 'ok');
    if (SW.manager && mounted === 'manager') SW.manager.render();
  };

  app.resetDemo = async function () {
    if (!(await U.confirm('Reset demo data?', 'All data on this device will be replaced with fresh demo data. You will be signed out.', 'Reset demo data', true))) return;
    await SW.demo.seed();
    SW.session = null;
    localStorage.removeItem('sw_session');
    U.toast('Demo data reset', 'ok');
    location.hash = '#/login';
    mounted = null;
    app.route();
  };

  /* ---------------- Printing ---------------- */
  app.print = function (html, title) {
    let host = document.getElementById('print-root');
    if (!host) { host = document.createElement('div'); host.id = 'print-root'; document.body.appendChild(host); }
    host.innerHTML = html;
    const prevTitle = document.title;
    document.title = (title || 'SecureWatch') + ' — ' + U.today();
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); host.innerHTML = ''; document.title = prevTitle; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains('printing')) done(); }, 1500); }, 60);
  };

  /* ---------------- Privacy ---------------- */
  app.privacyHtml = function () {
    return '<div class="privacy">' +
      '<p><b>What this app records.</b> Shift clock-in and clock-out times, GPS position and accuracy when you start or end a shift, scan a checkpoint, confirm a welfare check, report an incident or activate SOS; incident details and any photos, video or voice notes you attach; basic device information (browser and operating system); and an audit log of actions.</p>' +
      '<p><b>Location.</b> Location is captured only at the moment of those actions. SecureWatch does not track you continuously in the background.</p>' +
      '<p><b>Where data is kept.</b> In this prototype everything is stored in this browser on this device (IndexedDB). Nothing is sent to a server. Clearing the browser\u2019s site data deletes it. Anyone with access to this device and browser can view it.</p>' +
      '<p><b>Sharing.</b> Data leaves the device only if a user exports a file (backup, CSV or printed report).</p>' +
      '<p><b>Your employer is the data controller.</b> Before real use, your employer must complete its own data protection assessment, publish a full privacy notice, set retention periods and deploy proper authentication and access control. This prototype does not by itself make any organisation GDPR or UK GDPR compliant.</p>' +
      '</div>';
  };

  /* ---------------- Service worker ---------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('service-worker.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) U.toast('An update is ready. Close and reopen SecureWatch to use it.', 'info', 7000);
        });
      });
    }).catch((e) => console.warn('Service worker registration failed', e));
  }

  document.addEventListener('DOMContentLoaded', app.boot);
})();
