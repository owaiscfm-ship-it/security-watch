/* SecureWatch — Management dashboard + read-only client portal */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util, db = SW.db, Q = SW.q, OPS = SW.ops;
  const esc = U.esc;

  const M = (SW.manager = { view: 'dashboard', filters: {}, mediaUrls: [] });

  const NAV = [
    ['dashboard', 'Dashboard', 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z'],
    ['live', 'Live Operations', 'M12 21s-6-5.6-6-11a6 6 0 0112 0c0 5.4-6 11-6 11zm0-9a2 2 0 100-4 2 2 0 000 4z'],
    ['guards', 'Guards', 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z'],
    ['sites', 'Sites', 'M4 21V7l8-4 8 4v14h-6v-6h-4v6H4z'],
    ['shifts', 'Shifts', 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z'],
    ['patrols', 'Patrols', 'M5 12l4 4L19 6'],
    ['checkpoints', 'Checkpoints', 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2'],
    ['incidents', 'Incidents', 'M12 4l9 16H3L12 4zm0 6v4m0 3v.5'],
    ['welfare', 'Welfare Checks', 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z'],
    ['reports', 'Reports', 'M7 3h7l5 5v13H7V3zm7 0v5h5M10 13h6M10 17h6'],
    ['client', 'Client Portal', 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zm9 2.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z'],
    ['settings', 'Settings', 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14.5 3h-5l-.4 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2l.4 2.6h5l.4-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z'],
    ['audit', 'Audit Log', 'M9 5H5v14h14v-4M9 9h6M9 13h3M15 3l6 6-7 7h-3v-3l4-4'],
  ];
  const ico = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + d + '"/></svg>';

  /* ---------------- Shell ---------------- */
  M.mount = function (root, view) {
    M.view = NAV.some((n) => n[0] === view) ? view : 'dashboard';
    root.innerHTML =
      '<div class="m-app">' +
      '<aside class="m-side" id="m-side"><div class="m-brand"><span class="logo-mark" aria-hidden="true"></span><div><strong>SecureWatch</strong><small>Security Operations &amp; Patrol Management</small></div></div>' +
      '<nav aria-label="Management">' + NAV.map((n) => '<a href="#/manager/' + n[0] + '" data-v="' + n[0] + '"' + (n[0] === M.view ? ' aria-current="page"' : '') + '>' + ico(n[2]) + '<span>' + n[1] + '</span></a>').join('') + '</nav>' +
      '<div class="m-side-foot"><span>' + esc(SW.session.displayName) + '</span><span class="side-links">' + (SW.remote.enabled ? '<button class="link-btn" id="m-pw">Change password</button> · ' : '') + '<button class="link-btn" id="m-logout">Sign out</button></span></div><p class="credit credit-side">SecureWatch by Syed Owais</p></aside>' +
      '<div class="m-main"><header class="m-top"><button class="icon-btn m-burger" id="m-burger" aria-label="Menu">☰</button><h1 id="m-title"></h1><div class="m-top-r">' +
      (db.settings().demoMode ? '<span class="badge badge-demo">Training mode</span>' : '') +
      '<span class="chip ' + (navigator.onLine ? 'chip-ok' : 'chip-bad') + '" id="m-net"><i></i>' + (navigator.onLine ? 'Online' : 'Offline') + '</span>' +
      (SW.remote.enabled ? '<button class="btn btn-sm ' + (('Notification' in window && Notification.permission === 'granted') ? 'btn-ghost' : 'btn-secondary') + '" id="m-bell" title="Pop-up alerts on this device">' + (('Notification' in window && Notification.permission === 'granted') ? '🔔 Alerts on' : '🔕 Turn on alerts') + '</button>' : '') +
      '<button class="btn btn-secondary btn-sm" id="m-refresh" title="Fetch the latest data">Refresh</button></div></header>' +
      '<main class="m-content" id="m-view" tabindex="-1"></main></div></div>';
    U.$('#m-logout').onclick = () => SW.app.logout();
    const pw = U.$('#m-pw'); if (pw) pw.onclick = () => SW.app.changePassword();
    const bell = U.$('#m-bell'); if (bell) bell.onclick = async () => { await SW.app.enableAlerts(); M.mount(root, M.view); };
    U.$('#m-burger').onclick = () => U.$('#m-side').classList.toggle('open');
    U.$('#m-refresh').onclick = async () => { if (SW.remote.enabled && SW.app.syncNow) await SW.app.syncNow(); else await db.init(); M.render(); U.toast(SW.remote.enabled ? (SW.remote.lastError ? 'Sync problem: ' + SW.remote.lastError : 'Up to date') : 'Records reloaded from this device', 'ok'); };
    U.$$('#m-side nav a').forEach((a) => a.addEventListener('click', () => U.$('#m-side').classList.remove('open')));
    M.render();
    clearInterval(M.timer);
    M.timer = setInterval(async () => {
      if (document.hidden || U.$('.modal-wrap')) return;
      if (['dashboard', 'live'].includes(M.view)) {
        for (const s of Q.onDutyShifts()) await OPS.evaluateWelfare(s);
        M.render(true);
      }
    }, 30000);
  };
  M.unmount = function () { clearInterval(M.timer); revokeMedia(); };

  M.render = async function (quiet) {
    const v = U.$('#m-view');
    if (!v) return;
    const nav = NAV.find((n) => n[0] === M.view);
    U.$('#m-title').textContent = nav[1];
    document.title = nav[1] + ' — SecureWatch';
    U.$$('#m-side nav a').forEach((a) => (a.dataset.v === M.view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const y = window.scrollY;
    if (!quiet) for (const s of Q.onDutyShifts()) await OPS.evaluateWelfare(s);
    try { VIEWS[M.view](v); }
    catch (e) {
      console.error(e);
      v.innerHTML = '<div class="alert alert-amber"><div><b>This page could not be shown.</b> ' + esc(e.message) + '. Press Ctrl + Shift + R to load the latest version of the app. If it keeps happening, check every file was uploaded (including reports.js and dashboard.js).</div></div>';
    }
    if (quiet) window.scrollTo(0, y);
  };

  /* ---------------- Helpers ---------------- */
  function table(cols, rows, empty, opts) {
    opts = opts || {};
    if (!rows.length) return '<div class="empty"><p>' + esc(empty || 'No records yet.') + '</p></div>';
    return '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + cols.map((c) => '<th' + (c.num ? ' class="num"' : '') + '>' + esc(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r) => '<tr' + (opts.rowAttr ? ' ' + opts.rowAttr(r) : '') + '>' + cols.map((c) => '<td' + (c.num ? ' class="num"' : '') + ' data-l="' + esc(c.label) + '">' + c.html(r) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
  }
  M.table = table;
  const src = (r) => (r && r.source === 'demo' ? '<span class="src src-demo" title="Sample data created by demo mode">Demo</span>' : '<span class="src src-dev" title="Recorded by a browser/device">Device</span>');
  M.src = src;
  function avatar(g, size) {
    size = size || 36;
    const name = (g && g.name) || '?';
    const ini = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    return g && g.photo && /^data:image\//.test(g.photo)
      ? '<img class="avatar" src="' + g.photo + '" alt="" width="' + size + '" height="' + size + '">'
      : '<span class="avatar avatar-i" style="width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.38) + 'px">' + esc(ini) + '</span>';
  }
  M.avatar = avatar;
  function card(title, body, extra) { return '<section class="panel"><div class="panel-head"><h2>' + esc(title) + '</h2>' + (extra || '') + '</div>' + body + '</section>'; }
  M.card = card;
  function opt(v, l, sel) { return '<option value="' + esc(v) + '"' + (v === sel ? ' selected' : '') + '>' + esc(l) + '</option>'; }
  function siteOptions(sel, all) { return (all ? opt('', 'All sites', sel) : '') + db.all('sites').map((s) => opt(s.id, s.name, sel)).join(''); }
  function guardOptions(sel, all) { return (all ? opt('', 'All guards', sel) : '') + db.all('guards').map((g) => opt(g.id, g.name, sel)).join(''); }
  function formData(m) { const o = {}; m.querySelectorAll('[name]').forEach((el) => { o[el.name] = el.type === 'checkbox' ? el.checked : el.value; }); return o; }
  function fieldErr(m, name, msg) { const el = m.querySelector('[name="' + name + '"]'); if (el) { el.classList.add('invalid'); el.focus(); } U.toast(msg, 'error', 4500); return false; }
  function revokeMedia() { M.mediaUrls.forEach((u) => URL.revokeObjectURL(u)); M.mediaUrls = []; }
  function bindNav(v) { v.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => (location.hash = '#/manager/' + b.dataset.nav))); }

  /* ---------------- Status computations ---------------- */
  M.status = function (siteIds) {
    const inScope = (r) => !siteIds || siteIds.includes(r.siteId);
    const onDuty = Q.onDutyShifts().filter(inScope);
    const sh = onDuty[0] || null;
    const today = U.today();
    const todays = db.where('shifts', (s) => inScope(s) && (s.date === today || s.status === 'On duty'));
    const uniq = Array.from(new Set(todays));
    let scheduled = 0, completed = 0;
    uniq.forEach((s) => { scheduled += Q.scheduledPatrols(s); completed += db.where('patrols', (p) => p.shiftId === s.id && p.status === 'Complete').length; });
    const active = sh ? Q.activePatrol(sh.id) : null;
    const guardId = sh ? sh.guardId : null;
    const lastScan = guardId ? Q.lastScan(guardId) : db.where('checkpointScans', (s) => inScope(s) && s.status === 'Valid').sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    const lastWel = guardId ? Q.lastWelfare(guardId) : db.where('welfareChecks', (w) => inScope(w) && w.status === 'Confirmed').sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    const openInc = db.where('incidents', (i) => inScope(i) && i.status !== 'Resolved');
    const missedWel = sh ? db.where('welfareChecks', (w) => w.shiftId === sh.id && w.status === 'Missed') : [];
    return { onDuty, sh, scheduled, completed, active, lastScan, lastWel, openInc, missedWel, lastGps: guardId ? Q.lastGps(guardId) : null };
  };

  function kpis(st) {
    const k = (label, value, sub, cls) => '<div class="kpi ' + (cls || '') + '"><span class="kpi-l">' + esc(label) + '</span><b class="kpi-v">' + value + '</b><span class="kpi-s">' + sub + '</span></div>';
    const cp = st.lastScan ? db.get('checkpoints', st.lastScan.checkpointId) : null;
    return '<div class="kpis">' +
      k('Guard status', st.sh ? 'On duty' : 'Off duty', st.sh ? esc(Q.guardName(st.sh.guardId)) : 'No guard clocked in', st.sh ? 'kpi-ok' : 'kpi-mute') +
      k('Current patrol', st.active ? (st.active.status === 'Paused' ? 'Paused' : 'Active') : 'Not active', st.active ? (function () { const p = Q.patrolProgress(st.active); return p.done + '/' + p.total + ' checkpoints'; })() : 'No patrol running', st.active ? 'kpi-blue' : 'kpi-mute') +
      k('Last checkpoint', cp ? esc(cp.name) : '—', st.lastScan ? U.fmtTime(st.lastScan.at) + ' on ' + U.fmtDate(st.lastScan.at) : 'No scans yet') +
      k("Today's patrols", st.completed + ' / ' + st.scheduled, 'completed / scheduled') +
      k('Incidents', String(st.openInc.length), 'open or under review', st.openInc.length ? 'kpi-warn' : '') +
      k('Welfare', st.lastWel ? U.fmtTime(st.lastWel.at) : '—', st.missedWel.length ? '<span class="red-text">' + st.missedWel.length + ' missed this shift</span>' : st.lastWel ? 'last confirmed ' + U.fmtDate(st.lastWel.at) : 'No checks yet', st.missedWel.length ? 'kpi-bad' : '') +
      '</div>';
  }

  function liveStatusBlock(st) {
    if (!st.sh) {
      const next = db.where('shifts', (s) => s.status === 'Scheduled' && new Date(s.endAt) > new Date()).sort((a, b) => (a.startAt > b.startAt ? 1 : -1))[0];
      return '<div class="live-off"><p><b>No guard is on duty</b> according to records on this device.</p>' + (next ? '<p class="muted">Next shift: ' + esc(Q.guardName(next.guardId)) + ' at ' + esc(Q.siteName(next.siteId)) + ', ' + U.fmtDate(next.startAt) + ' ' + esc(next.start) + '–' + esc(next.end) + '</p>' : '') + '</div>';
    }
    const s = st.sh;
    const cp = st.lastScan ? db.get('checkpoints', st.lastScan.checkpointId) : null;
    const age = st.lastGps ? Date.now() - new Date(st.lastGps.at).getTime() : null;
    const row = (l, v) => '<div><dt>' + l + '</dt><dd>' + v + '</dd></div>';
    return '<dl class="live-dl">' +
      row('Guard', '<span class="who">' + avatar(Q.guard(s.guardId), 28) + esc(Q.guardName(s.guardId)) + '</span>') +
      row('Site', esc(Q.siteName(s.siteId))) +
      row('Status', '<span class="dot dot-green"></span> On duty since ' + U.fmtTime(s.actualStart)) +
      row('Shift', esc(s.start) + ' – ' + esc(s.end)) +
      row('Last GPS', st.lastGps ? U.fmtTime(st.lastGps.at) + ' <span class="muted">(' + U.minsLabel(age) + ', ±' + st.lastGps.gps.accuracy + ' m)</span> ' + src(st.lastGps) + (U.mapLink(st.lastGps.gps) ? ' <a href="' + U.mapLink(st.lastGps.gps) + '" target="_blank" rel="noopener">Map</a>' : '') : 'None recorded') +
      row('Last checkpoint', cp ? esc(cp.name) + ' at ' + U.fmtTime(st.lastScan.at) + ' ' + src(st.lastScan) : '—') +
      row('Last welfare check', st.lastWel ? U.fmtTime(st.lastWel.at) + ' ' + src(st.lastWel) : '—') +
      '</dl>' +
      '<p class="note">' + (SW.remote.enabled ? 'Last events received from the guard\u2019s phone (devices sync about every 20 seconds while they have signal).' : 'These are the last events <b>saved in this browser</b>.') + ' GPS is captured only when the guard performs an action (clock-in, scan, welfare, incident, SOS) — this is not continuous live tracking.</p>';
  }

  function alertsHtml(siteIds, canAct) {
    const inScope = (r) => !siteIds || siteIds.includes(r.siteId);
    let html = '';
    db.where('sosEvents', (e) => inScope(e) && e.status !== 'Resolved').forEach((e) => {
      html += '<div class="alert alert-red"><div><b>SOS ' + (e.status === 'Active' ? 'ACTIVE' : 'acknowledged') + '</b> — ' + esc(Q.guardName(e.guardId)) + ', ' + esc(Q.siteName(e.siteId)) + ' at ' + U.fmtDateTime(e.at) + '. Location: ' + esc(U.gpsLabel(e.gps)) + (U.mapLink(e.gps) ? ' <a href="' + U.mapLink(e.gps) + '" target="_blank" rel="noopener">Map</a>' : '') + ' ' + src(e) + '</div>' +
        (canAct ? '<div class="alert-act">' + (e.status === 'Active' ? '<button class="btn btn-sm btn-white" data-sos="' + esc(e.id) + '" data-st="Acknowledged">Acknowledge</button>' : '') + '<button class="btn btn-sm btn-white" data-sos="' + esc(e.id) + '" data-st="Resolved">Resolve</button></div>' : '') + '</div>';
    });
    Q.onDutyShifts().filter(inScope).forEach((s) => {
      const missed = db.where('welfareChecks', (w) => w.shiftId === s.id && w.status === 'Missed');
      if (missed.length) {
        const last = missed.sort((a, b) => (a.dueAt < b.dueAt ? 1 : -1))[0];
        html += '<div class="alert alert-red"><div><b>Missed welfare check</b> — ' + esc(Q.guardName(s.guardId)) + ' did not confirm the check due at ' + U.fmtTime(last.dueAt) + (missed.length > 1 ? ' (' + missed.length + ' missed this shift)' : '') + '. No automatic call or message has been sent — contact the guard directly.</div></div>';
      }
    });
    const since = Date.now() - 24 * 3600000;
    const inc = db.where('patrols', (p) => inScope(p) && p.status === 'Incomplete' && new Date(p.endAt).getTime() > since);
    if (inc.length) html += '<div class="alert alert-amber"><div><b>' + inc.length + ' incomplete patrol' + (inc.length > 1 ? 's' : '') + '</b> in the last 24 hours — ' + inc.map((p) => esc(p.id) + ' missing ' + esc(p.missed.filter((m) => m.required).map((m) => m.name).join(', '))).join('; ') + '</div></div>';
    return html;
  }
  function bindSos(v) {
    v.querySelectorAll('[data-sos]').forEach((b) => (b.onclick = async () => { await OPS.updateSOS(db.get('sosEvents', b.dataset.sos), b.dataset.st); U.toast('SOS ' + b.dataset.st.toLowerCase(), 'ok'); M.render(); }));
  }

  /* ---------------- Views ---------------- */
  const VIEWS = {};
  M.VIEWS = VIEWS;
  M.alertsHtml = (a, b) => alertsHtml(a, b);
  M.bindSos = (v) => bindSos(v);
  M.liveStatusBlock = (st) => liveStatusBlock(st);
  M.bindNav = (v) => bindNav(v);

  VIEWS.dashboard = function (v) {
    const st = M.status();
    const recentInc = db.all('incidents').slice().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);
    const audits = db.all('auditLogs').slice().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 8);
    const days = []; for (let i = 13; i >= 0; i--) days.push(U.ymdAdd(U.today(), -i));
    const site = (db.all('sites')[0] || {}).id;
    const trend = SW.reports.compute(null, days[0], days[13]).perDay;
    const W = 560, H = 120, bw = 26;
    const chart = '<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Patrol completion, last 14 days">' + trend.map((d, i) => {
      const v = d.sched ? Math.min(1, d.patrols / d.sched) : 0, h = Math.round(v * (H - 34)), x = 8 + i * ((W - 16) / 14);
      const col = !d.sched ? '#E9EDF4' : v >= 0.95 ? '#188A52' : v >= 0.7 ? '#E0A100' : '#C8293A';
      return '<rect x="' + x + '" y="' + (H - 20 - h) + '" width="' + bw + '" height="' + Math.max(2, h) + '" rx="3" fill="' + col + '"><title>' + d.date + ': ' + d.patrols + '/' + d.sched + ' patrols</title></rect><text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" font-size="10" text-anchor="middle" fill="#4A5878">' + new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric' }) + '</text>';
    }).join('') + '</svg>';
    const warn = db.settings().licenceWarnDays;
    const team = db.all('guards').filter((g) => g.status === 'Active').map((g) => {
      const on = st.onDuty.find((x) => x.guardId === g.id);
      const next = on ? null : db.where('shifts', (x) => x.guardId === g.id && x.status === 'Scheduled' && new Date(x.endAt) > new Date()).sort((a, b) => (a.startAt > b.startAt ? 1 : -1))[0];
      const l = U.licenceStatus(g.siaExpiry, warn);
      return '<div class="team-row">' + avatar(g, 40) + '<div><b>' + esc(g.name) + '</b><small>' + (on ? '<span class="dot dot-green"></span> On duty since ' + U.fmtTime(on.actualStart) : next ? 'Next: ' + U.fmtShortDate(next.startAt) + ' ' + esc(next.start) : 'No upcoming shift') + '</small></div>' + U.badge(l.icon + ' SIA', l.cls) + '</div>';
    }).join('');
    v.innerHTML = alertsHtml(null, true) + kpis(st) +
      '<div class="grid-2">' +
      card('Patrol completion — last 14 days', chart + '<p class="rp-legend"><i style="background:#188A52"></i>95%+ <i style="background:#E0A100"></i>70–94% <i style="background:#C8293A"></i>under 70%</p>', '<button class="btn btn-sm btn-secondary" data-nav="reports">Reports</button>') +
      card('Team', team || '<div class="empty"><p>No active guards.</p></div>', '<button class="btn btn-sm btn-secondary" data-nav="guards">Guards</button>') +
      '</div><div class="grid-2">' +
      card('Live guard status', liveStatusBlock(st), '<button class="btn btn-sm btn-secondary" data-nav="live">Open live operations</button>') +
      card('Recent activity', audits.length ? '<ul class="feed">' + audits.map((a) => '<li><time>' + U.fmtDateTime(a.at) + '</time><div><b>' + esc(a.action) + '</b> ' + esc(a.subject) + '<small>' + esc(a.user) + (a.related ? ' — ' + esc(a.related) : '') + '</small></div></li>').join('') + '</ul>' : '<div class="empty"><p>No activity yet.</p></div>', '<button class="btn btn-sm btn-secondary" data-nav="audit">Audit log</button>') +
      '</div>' +
      card('Recent incidents', table([
        { label: 'Incident', html: (r) => '<a href="#" data-inc="' + esc(r.id) + '">' + esc(r.id) + '</a>' },
        { label: 'Date / time', html: (r) => U.fmtDateTime(r.at) },
        { label: 'Type', html: (r) => esc(r.type) },
        { label: 'Severity', html: (r) => U.badge(r.severity, U.statusCls(r.severity)) },
        { label: 'Status', html: (r) => U.badge(r.status, U.statusCls(r.status)) },
        { label: 'Data', html: src },
      ], recentInc, 'No incidents have been reported.'), '<button class="btn btn-sm btn-secondary" data-nav="incidents">All incidents</button>');
    bindNav(v); bindSos(v); bindInc(v, true);
  };

  VIEWS.live = function (v) {
    const shifts = Q.onDutyShifts();
    let html = alertsHtml(null, true) +
      (SW.remote.enabled ? '<div class="note-box"><b>About this view.</b> Devices sync with the server about every 20 seconds while they have signal. GPS is captured only when the guard does something (clock in, scan, welfare, incident, SOS) — this is not continuous tracking.</div>' : '<div class="note-box"><b>About this view.</b> SecureWatch on GitHub Pages has no server, so this page can only show records saved in <b>this browser</b>. If the guard uses a different phone, their records appear here only after they use <i>More › Send my data to a manager</i> and you import the file in Settings. Each event is labelled <span class="src src-dev">Device</span> (recorded by a real browser) or <span class="src src-demo">Demo</span> (sample data).</div>');
    if (!shifts.length) html += card('Guard status', liveStatusBlock(M.status()));
    shifts.forEach((s) => {
      const st = M.status([s.siteId]);
      const evs = timeline(s);
      const p = Q.activePatrol(s.id);
      let prog = '';
      if (p) {
        const pr = Q.patrolProgress(p);
        prog = '<div class="live-patrol"><b>' + esc(Q.routeName(p.routeId)) + '</b> — ' + pr.done + '/' + pr.total + ' checkpoints, ' + (p.status === 'Paused' ? 'paused' : 'running for ' + U.duration(Q.patrolElapsed(p))) +
          '<ul class="cp-inline">' + pr.cps.map((c) => '<li class="' + (pr.scanned.has(c.id) ? 'done' : '') + '">' + (pr.scanned.has(c.id) ? '✓ ' : '○ ') + esc(c.name) + '</li>').join('') + '</ul></div>';
      }
      html += '<div class="grid-2">' + card(Q.siteName(s.siteId), liveStatusBlock(st) + prog) +
        card('Shift timeline', evs.length ? '<ul class="feed">' + evs.map((e) => '<li><time>' + U.fmtTime(e.at) + '</time><div><b>' + esc(e.title) + '</b> ' + src(e.rec) + '<small>' + esc(e.detail) + '</small></div></li>').join('') + '</ul>' : '<div class="empty"><p>No events yet.</p></div>') + '</div>';
    });
    v.innerHTML = html;
    bindSos(v);
  };

  function timeline(s) {
    const out = [];
    const from = s.actualStart || s.startAt;
    db.where('attendance', (a) => a.shiftId === s.id).forEach((a) => out.push({ at: a.at, title: a.type, detail: U.gpsLabel(a.gps) + (a.distance != null ? ', ' + a.distance + ' m from site' : ''), rec: a }));
    db.where('checkpointScans', (x) => x.guardId === s.guardId && x.at >= from && (!s.actualEnd || x.at <= s.actualEnd)).forEach((x) => out.push({ at: x.at, title: x.status === 'Valid' ? 'Checkpoint: ' + ((db.get('checkpoints', x.checkpointId) || {}).name || x.checkpointId) : 'Invalid scan', detail: (x.locationStatus || '') + (x.method ? ' — ' + x.method : ''), rec: x }));
    db.where('welfareChecks', (w) => w.shiftId === s.id).forEach((w) => out.push({ at: w.at || w.dueAt, title: 'Welfare ' + w.status.toLowerCase(), detail: w.status === 'Missed' ? 'Due ' + U.fmtTime(w.dueAt) : U.gpsLabel(w.gps), rec: w }));
    db.where('incidents', (i) => i.shiftId === s.id).forEach((i) => out.push({ at: i.at, title: i.id + ' ' + i.type, detail: i.severity + ' — ' + i.status, rec: i }));
    db.where('patrols', (p) => p.shiftId === s.id).forEach((p) => { out.push({ at: p.startAt, title: 'Patrol started ' + p.id, detail: Q.routeName(p.routeId), rec: p }); if (p.endAt) out.push({ at: p.endAt, title: 'Patrol ' + p.status.toLowerCase(), detail: p.verified + '/' + p.total + ' checkpoints', rec: p }); });
    db.where('sosEvents', (e) => e.shiftId === s.id).forEach((e) => out.push({ at: e.at, title: 'SOS ' + e.status.toLowerCase(), detail: U.gpsLabel(e.gps), rec: e }));
    return out.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40);
  }

  /* ---- Guards ---- */
  VIEWS.guards = function (v) {
    const warn = db.settings().licenceWarnDays;
    const rows = db.all('guards').slice().sort((a, b) => (a.name > b.name ? 1 : -1));
    v.innerHTML = '<div class="toolbar"><p class="muted">Licence status is calculated from the expiry date entered. Always confirm licences on the <a href="https://services.sia.homeoffice.gov.uk/rolh" target="_blank" rel="noopener">SIA register of licence holders</a>.</p><button class="btn btn-primary" id="g-add">Add guard</button></div>' +
      card('Guards (' + rows.length + ')', table([
        { label: 'Name', html: (g) => '<button class="who who-btn" data-prof="' + esc(g.id) + '" title="View profile and performance">' + avatar(g, 34) + '<b>' + esc(g.name) + '</b></button>' },
        { label: 'SIA licence', html: (g) => '<span class="mono-ish">•••• ' + esc(String(g.siaNumber || '').slice(-4)) + '</span><small class="blk">' + esc(g.siaLicenceType || '') + '</small>' + (g.siaNumber2 ? '<span class="mono-ish blk">•••• ' + esc(String(g.siaNumber2).slice(-4)) + '</span><small class="blk">' + esc(g.siaLicenceType2 || 'Second licence') + '</small>' : '') },
        { label: 'Expiry', html: (g) => U.fmtDate(g.siaExpiry) + (g.siaNumber2 ? '<span class="blk">' + U.fmtDate(g.siaExpiry2) + '</span>' : '') },
        { label: 'Licence status', html: (g) => { const l = U.licenceStatus(g.siaExpiry, warn); let h = U.badge(l.icon + ' ' + l.label, l.cls); if (g.siaNumber2) { const l2 = U.licenceStatus(g.siaExpiry2, warn); h += '<span class="blk">' + U.badge(l2.icon + ' ' + l2.label, l2.cls) + '</span>'; } return h; } },
        { label: 'Register check', html: (g) => (g.siaCheckedAt ? 'Checked ' + U.fmtDate(g.siaCheckedAt) : '<span class="amber-text">Not checked</span>') },
        { label: 'Contact', html: (g) => esc(g.phone || '') + '<small class="blk">' + esc(g.email || '') + '</small>' },
        { label: 'Status', html: (g) => U.badge(g.status, g.status === 'Active' ? 'green' : g.status === 'Suspended' ? 'red' : 'grey') },
        { label: 'Login', html: (g) => { if (SW.remote.enabled) return '<span class="muted">See Settings</span>'; const u = SW.auth.users().find((x) => x.guardId === g.id); return u ? esc(u.username) : '<span class="muted">None</span>'; } },
        { label: '', html: (g) => '<button class="btn btn-sm btn-secondary" data-edit="' + esc(g.id) + '">Edit</button>' },
      ], rows, 'No guards yet. Add your first guard.'));
    U.$('#g-add', v).onclick = () => guardForm();
    v.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => guardForm(db.get('guards', b.dataset.edit))));
    v.querySelectorAll('[data-prof]').forEach((b) => (b.onclick = () => M.guardProfile && M.guardProfile(b.dataset.prof)));
  };

  function resizePhoto(file, size) {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = size; c.height = size;
        const s2 = Math.min(img.width, img.height), sx = (img.width - s2) / 2, sy = Math.max(0, (img.height - s2) / 2 - s2 * 0.08);
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, s2, s2, 0, 0, size, size);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }
  async function guardForm(g) {
    const isNew = !g;
    g = g || { status: 'Active' };
    const user = !isNew ? SW.auth.users().find((x) => x.guardId === g.id) : null;
    const res = await U.modal({
      title: isNew ? 'Add guard' : 'Edit ' + g.name,
      wide: true,
      onOpen: (m) => {
        const inp = m.querySelector('#ph-file'), rm = m.querySelector('#ph-rm'), prev = m.querySelector('#ph-prev');
        inp.onchange = async () => {
          const f = inp.files[0]; if (!f) return;
          try { m._photo = await resizePhoto(f, 256); prev.innerHTML = avatar({ name: g.name, photo: m._photo }, 84); rm.hidden = false; }
          catch (e) { U.toast('Could not read that image.', 'error'); }
        };
        rm.onclick = () => { m._photo = ''; prev.innerHTML = avatar({ name: g.name || '?' }, 84); rm.hidden = true; };
      },
      body: '<div class="photo-edit"><div id="ph-prev">' + avatar(g, 84) + '</div><div><label class="btn btn-secondary btn-sm file-btn">' + (g.photo ? 'Change photo' : 'Add profile photo') + '<input type="file" accept="image/*" id="ph-file" hidden></label> <button type="button" class="btn btn-sm btn-ghost" id="ph-rm"' + (g.photo ? '' : ' hidden') + '>Remove</button><p class="muted">A clear head-and-shoulders photo, like an ID badge. It is resized automatically.</p></div></div>' +
        '<div class="form-grid">' +
        '<label class="fld"><span>Full name *</span><input name="name" maxlength="80" value="' + esc(g.name || '') + '" required></label>' +
        '<label class="fld"><span>Status</span><select name="status">' + ['Active', 'Inactive', 'Suspended'].map((s) => opt(s, s, g.status)).join('') + '</select></label>' +
        '<label class="fld"><span>SIA licence number * (16 digits)</span><input name="siaNumber" inputmode="numeric" maxlength="19" value="' + esc(U.fmtSia(g.siaNumber || '')) + '" autocomplete="off"></label>' +
        '<label class="fld"><span>Licence type</span><select name="siaLicenceType">' + ['Security Guarding', 'Door Supervision', 'CCTV (Public Space Surveillance)', 'Close Protection', 'Cash and Valuables in Transit', 'Key Holding', 'Vehicle Immobilising'].map((s) => opt(s, s, g.siaLicenceType)).join('') + '</select></label>' +
        '<label class="fld"><span>SIA licence expiry date *</span><input type="date" name="siaExpiry" value="' + esc(g.siaExpiry || '') + '"></label>' +
        '<label class="fld"><span>Second SIA licence number (optional)</span><input name="siaNumber2" inputmode="numeric" maxlength="19" value="' + esc(U.fmtSia(g.siaNumber2 || '')) + '" autocomplete="off"></label>' +
        '<label class="fld"><span>Second licence expiry</span><input type="date" name="siaExpiry2" value="' + esc(g.siaExpiry2 || '') + '"></label>' +
        '<label class="fld chk"><input type="checkbox" name="siaChecked"' + (g.siaCheckedAt ? ' checked' : '') + '><span>I have checked this licence on the SIA public register' + (g.siaCheckedAt ? ' (last ' + U.fmtDate(g.siaCheckedAt) + ')' : '') + '</span></label>' +
        '<label class="fld"><span>Phone</span><input name="phone" type="tel" maxlength="20" value="' + esc(g.phone || '') + '"></label>' +
        '<label class="fld"><span>Email</span><input name="email" type="email" maxlength="120" value="' + esc(g.email || '') + '"></label>' +
        '</div>' +
        '<p class="muted">' + (user ? 'Login: <b>' + esc(user.username) + '</b>. ' : 'No login yet. ') + 'Logins are managed in Settings › Logins.</p>',
      actions: [].concat(isNew ? [] : [{ label: 'Delete', cls: 'btn-danger-ghost', value: 'delete' }]).concat([{ label: 'Cancel', value: null }, {
        label: isNew ? 'Add guard' : 'Save changes', cls: 'btn-primary', onClick: async (m) => {
          const f = formData(m);
          f.name = U.clean(f.name, 80);
          f.siaNumber = String(f.siaNumber).replace(/\s/g, '');
          if (f.name.length < 2) return fieldErr(m, 'name', 'Enter the guard\u2019s full name.');
          if (!U.validSia(f.siaNumber)) return fieldErr(m, 'siaNumber', 'SIA licence numbers are 16 digits.');
          if (db.all('guards').some((x) => x.siaNumber === f.siaNumber && x.id !== g.id)) return fieldErr(m, 'siaNumber', 'Another guard already has this licence number.');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(f.siaExpiry)) return fieldErr(m, 'siaExpiry', 'Enter the licence expiry date.');
          f.siaNumber2 = String(f.siaNumber2 || '').replace(/\s/g, '');
          if (f.siaNumber2 && !U.validSia(f.siaNumber2)) return fieldErr(m, 'siaNumber2', 'SIA licence numbers are 16 digits.');
          if (f.siaNumber2 && !/^\d{4}-\d{2}-\d{2}$/.test(f.siaExpiry2)) return fieldErr(m, 'siaExpiry2', 'Enter the second licence expiry date.');
          if (!U.validPhone(f.phone)) return fieldErr(m, 'phone', 'Enter a valid phone number.');
          if (!U.validEmail(f.email)) return fieldErr(m, 'email', 'Enter a valid email address.');
          if (m._photo !== undefined) g.photo = m._photo;
          const rec = Object.assign(g, { name: f.name, status: f.status, siaNumber: f.siaNumber, siaLicenceType: f.siaLicenceType, siaExpiry: f.siaExpiry, siaNumber2: f.siaNumber2 || '', siaExpiry2: f.siaNumber2 ? f.siaExpiry2 : '', phone: U.clean(f.phone, 20), email: U.clean(f.email, 120) });
          if (f.siaChecked && !g.siaCheckedAt) rec.siaCheckedAt = new Date().toISOString();
          if (!f.siaChecked) rec.siaCheckedAt = null;
          if (isNew) { rec.id = SW.seq('guards', 'G'); rec.source = 'device'; }
          await db.put('guards', rec);
          await db.audit(isNew ? 'Guard added' : 'Guard updated', { subject: rec.name, related: rec.id });
          return 'saved';
        },
      }]),
    });
    if (res === 'delete') {
      if (db.where('shifts', (s) => s.guardId === g.id).length) { U.toast('This guard has shifts on record. Set their status to Inactive instead.', 'error', 5000); return; }
      if (!(await U.confirm('Delete guard?', 'Delete ' + g.name + '? This cannot be undone.', 'Delete', true))) return;
      await db.remove('guards', g.id);
      await db.audit('Guard deleted', { subject: g.name });
    }
    if (res) { U.toast(res === 'delete' ? 'Guard deleted' : 'Guard saved', 'ok'); M.render(); }
  }

  /* ---- Sites ---- */
  VIEWS.sites = function (v) {
    const rows = db.all('sites');
    v.innerHTML = '<div class="toolbar"><span></span><button class="btn btn-primary" id="s-add">Add site</button></div>' +
      card('Sites (' + rows.length + ')', table([
        { label: 'Site', html: (s) => '<b>' + esc(s.name) + '</b><small class="blk">' + esc(s.address || '') + '</small>' },
        { label: 'Client', html: (s) => esc(s.client || '') + '<small class="blk">' + esc(s.contactName || '') + ' ' + esc(s.contactPhone || '') + '</small>' },
        { label: 'GPS', html: (s) => (s.lat != null ? s.lat.toFixed(5) + ', ' + s.lng.toFixed(5) : '<span class="amber-text">Not set</span>') },
        { label: 'Routes', num: true, html: (s) => String(Q.routesForSite(s.id).length) },
        { label: 'Checkpoints', num: true, html: (s) => String(Q.checkpointsForSite(s.id).length) },
        { label: 'Instructions', html: (s) => { const i = Q.instructionsFor(s.id); return i ? 'v' + i.version + ' — ' + U.fmtDate(i.updatedAt) : '<span class="muted">None</span>'; } },
        { label: '', html: (s) => '<button class="btn btn-sm btn-secondary" data-edit="' + esc(s.id) + '">Edit</button> <button class="btn btn-sm btn-ghost" data-routes="' + esc(s.id) + '">Routes</button>' },
      ], rows, 'No sites yet. Add a site to start building patrol routes.'));
    U.$('#s-add', v).onclick = () => siteForm();
    v.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => siteForm(db.get('sites', b.dataset.edit))));
    v.querySelectorAll('[data-routes]').forEach((b) => (b.onclick = () => { M.filters.routeSite = b.dataset.routes; location.hash = '#/manager/patrols'; }));
  };

  async function siteForm(s) {
    const isNew = !s;
    s = s || {};
    const ins = !isNew ? Q.instructionsFor(s.id) : null;
    const res = await U.modal({
      title: isNew ? 'Add site' : 'Edit ' + s.name,
      wide: true,
      body: '<div class="form-grid">' +
        '<label class="fld"><span>Site name *</span><input name="name" maxlength="100" value="' + esc(s.name || '') + '"></label>' +
        '<label class="fld"><span>Client name</span><input name="client" maxlength="100" value="' + esc(s.client || '') + '"></label>' +
        '<label class="fld span2"><span>Address</span><input name="address" maxlength="200" value="' + esc(s.address || '') + '"></label>' +
        '<label class="fld"><span>Site contact</span><input name="contactName" maxlength="80" value="' + esc(s.contactName || '') + '"></label>' +
        '<label class="fld"><span>Contact phone</span><input name="contactPhone" maxlength="20" value="' + esc(s.contactPhone || '') + '"></label>' +
        '<label class="fld"><span>Latitude</span><input name="lat" inputmode="decimal" value="' + esc(s.lat != null ? s.lat : '') + '"></label>' +
        '<label class="fld"><span>Longitude</span><input name="lng" inputmode="decimal" value="' + esc(s.lng != null ? s.lng : '') + '"></label>' +
        '<div class="span2"><button type="button" class="btn btn-sm btn-secondary" id="use-loc">Use my current location</button> <span class="muted" id="loc-msg"></span></div>' +
        '<label class="fld chk span2"><input type="checkbox" name="mediaAllowed"' + (s.mediaAllowed === false ? '' : ' checked') + '><span>Guards may attach photos, video and voice notes to incident reports (turn off if the client contract forbids recordings on site)</span></label>' +
        '<label class="fld span2"><span>Emergency contacts (one per line)</span><textarea name="emergencyContacts" rows="4" maxlength="1000">' + esc(s.emergencyContacts || '') + '</textarea></label>' +
        '<label class="fld span2"><span>Site instructions (one per line — guards must acknowledge changes)</span><textarea name="instructions" rows="7" maxlength="5000">' + esc(ins ? ins.text : '') + '</textarea></label>' +
        '</div>',
      onOpen: (m) => {
        m.querySelector('#use-loc').onclick = async () => {
          const msg = m.querySelector('#loc-msg'); msg.textContent = 'Locating…';
          const g = await U.getGPS();
          if (g.ok) { m.querySelector('[name=lat]').value = g.lat; m.querySelector('[name=lng]').value = g.lng; msg.textContent = 'Set (±' + g.accuracy + ' m)'; }
          else msg.textContent = g.error;
        };
      },
      actions: [].concat(isNew ? [] : [{ label: 'Delete', cls: 'btn-danger-ghost', value: 'delete' }]).concat([{ label: 'Cancel', value: null }, {
        label: isNew ? 'Add site' : 'Save changes', cls: 'btn-primary', onClick: async (m) => {
          const f = formData(m);
          if (U.clean(f.name).length < 2) return fieldErr(m, 'name', 'Enter a site name.');
          const lat = f.lat === '' ? null : Number(f.lat), lng = f.lng === '' ? null : Number(f.lng);
          if ((lat === null) !== (lng === null) || (lat !== null && (isNaN(lat) || lat < -90 || lat > 90 || isNaN(lng) || lng < -180 || lng > 180))) return fieldErr(m, 'lat', 'Enter both latitude and longitude as decimal numbers, or leave both empty.');
          Object.assign(s, { name: U.clean(f.name, 100), client: U.clean(f.client, 100), address: U.clean(f.address, 200), contactName: U.clean(f.contactName, 80), contactPhone: U.clean(f.contactPhone, 20), emergencyContacts: U.clean(f.emergencyContacts, 1000), lat, lng, mediaAllowed: !!f.mediaAllowed });
          if (isNew) { s.id = SW.seq('sites', 'S'); s.source = 'device'; }
          await db.put('sites', s);
          const text = U.clean(f.instructions, 5000);
          const cur = Q.instructionsFor(s.id);
          if (text && (!cur || cur.text !== text)) {
            await db.put('siteInstructions', Object.assign(cur || { id: 'INS-' + s.id, siteId: s.id, version: 0, source: 'device' }, { text, version: (cur ? cur.version : 0) + 1, updatedBy: SW.session.displayName }));
            await db.audit('Site instructions updated', { siteId: s.id, subject: s.name });
          }
          await db.audit(isNew ? 'Site added' : 'Site updated', { siteId: s.id, subject: s.name, related: s.id });
          return 'saved';
        },
      }]),
    });
    if (res === 'delete') {
      if (db.where('shifts', (x) => x.siteId === s.id).length || db.where('checkpoints', (x) => x.siteId === s.id).length) { U.toast('This site has shifts or checkpoints. Remove those first.', 'error', 5000); return; }
      if (!(await U.confirm('Delete site?', 'Delete ' + s.name + '?', 'Delete', true))) return;
      await db.remove('sites', s.id);
      for (const r of Q.routesForSite(s.id)) await db.remove('patrolRoutes', r.id);
      await db.audit('Site deleted', { subject: s.name });
    }
    if (res) { U.toast(res === 'delete' ? 'Site deleted' : 'Site saved', 'ok'); M.render(); }
  }

  /* ---- Shifts ---- */
  VIEWS.shifts = function (v) {
    const s = db.settings();
    const now = new Date();
    const upcoming = db.where('shifts', (x) => x.status !== 'Completed' && new Date(x.endAt) > now || x.status === 'On duty').sort((a, b) => (a.startAt > b.startAt ? 1 : -1));
    const past = db.where('shifts', (x) => !upcoming.includes(x)).sort((a, b) => (a.startAt < b.startAt ? 1 : -1)).slice(0, 30);
    const cols = [
      { label: 'Date', html: (x) => U.fmtShortDate(x.startAt) },
      { label: 'Guard', html: (x) => esc(Q.guardName(x.guardId)) },
      { label: 'Site', html: (x) => esc(Q.siteName(x.siteId)) },
      { label: 'Shift', html: (x) => esc(x.start) + ' – ' + esc(x.end) },
      { label: 'Patrols', html: (x) => 'Every ' + x.patrolFreq + ' min (' + Q.scheduledPatrols(x) + ')' },
      { label: 'Welfare', html: (x) => 'Every ' + x.welfareFreq + ' min' },
      { label: 'Status', html: (x) => U.badge(x.status === 'Scheduled' && new Date(x.endAt) < now ? 'Not worked' : x.status, x.status === 'Scheduled' && new Date(x.endAt) < now ? 'red' : U.statusCls(x.status)) },
      { label: 'Clock in / out', html: (x) => (x.actualStart ? U.fmtTime(x.actualStart) : '—') + ' / ' + (x.actualEnd ? U.fmtTime(x.actualEnd) : '—') },
      { label: 'Data', html: src },
      { label: '', html: (x) => (x.status === 'Scheduled' ? '<button class="btn btn-sm btn-danger-ghost" data-del="' + esc(x.id) + '">Remove</button>' : '') },
    ];
    v.innerHTML = card('Add shift',
      '<form id="sh-form" class="form-grid form-inline" novalidate>' +
      '<label class="fld"><span>Guard</span><select name="guardId">' + db.where('guards', (g) => g.status === 'Active').map((g) => opt(g.id, g.name)).join('') + '</select></label>' +
      '<label class="fld"><span>Site</span><select name="siteId">' + siteOptions('') + '</select></label>' +
      '<label class="fld"><span>Date</span><input type="date" name="date" value="' + U.today() + '"></label>' +
      '<label class="fld"><span>Start</span><input type="time" name="start" value="20:00"></label>' +
      '<label class="fld"><span>End</span><input type="time" name="end" value="08:00"></label>' +
      '<label class="fld"><span>Patrol every (min)</span><input type="number" name="patrolFreq" min="15" max="720" value="' + s.patrolFrequency + '"></label>' +
      '<label class="fld"><span>Welfare every (min)</span><input type="number" name="welfareFreq" min="10" max="240" value="' + s.welfareInterval + '"></label>' +
      '<div class="fld fld-btn"><button class="btn btn-primary">Add shift</button></div>' +
      '</form><p class="muted">If the end time is earlier than the start time, the shift ends the next day.</p>') +
      card('Upcoming and current shifts', table(cols, upcoming, 'No upcoming shifts. Add one above.')) +
      card('Past shifts', table(cols, past, 'No past shifts.'));
    U.$('#sh-form', v).onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      if (!f.guardId) return U.toast('Add an active guard first.', 'error');
      if (!f.siteId) return U.toast('Add a site first.', 'error');
      if (!f.date || !f.start || !f.end) return U.toast('Enter date, start and end.', 'error');
      const pf = +f.patrolFreq, wf = +f.welfareFreq;
      if (!(pf >= 15 && pf <= 720)) return U.toast('Patrol frequency must be 15–720 minutes.', 'error');
      if (!(wf >= 10 && wf <= 240)) return U.toast('Welfare frequency must be 10–240 minutes.', 'error');
      const st = U.combine(f.date, f.start);
      let en = U.combine(f.date, f.end);
      if (en <= st) en = U.combine(U.ymdAdd(f.date, 1), f.end);
      if (en - st > 16 * 3600000) return U.toast('Shifts longer than 16 hours are not allowed.', 'error');
      const g = db.get('guards', f.guardId);
      const lic = U.licenceStatus(g.siaExpiry, db.settings().licenceWarnDays);
      if (lic.key === 'expired' || lic.key === 'unknown' || U.combine(g.siaExpiry, '23:59') < en) { U.toast(g.name + '\u2019s SIA licence is not valid for this shift date. Update the licence before rostering.', 'error', 6000); return; }
      const clash = db.where('shifts', (x) => x.guardId === g.id && new Date(x.startAt) < en && new Date(x.endAt) > st);
      if (clash.length) return U.toast(g.name + ' already has a shift that overlaps this time.', 'error', 5000);
      const rec = { id: SW.seq('shifts', 'SH'), guardId: g.id, siteId: f.siteId, date: f.date, start: f.start, end: f.end, startAt: st.toISOString(), endAt: en.toISOString(), patrolFreq: pf, welfareFreq: wf, status: 'Scheduled', source: 'device' };
      await db.put('shifts', rec);
      await db.audit('Shift created', { siteId: f.siteId, subject: g.name + ' ' + U.fmtDate(st) + ' ' + f.start + '–' + f.end, related: rec.id });
      if (lic.key === 'expiring') U.toast('Shift added. Note: ' + g.name + '\u2019s licence expires in ' + lic.days + ' days.', 'info', 6000);
      else U.toast('Shift added', 'ok');
      M.render();
    };
    v.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!(await U.confirm('Remove shift?', 'Remove this scheduled shift from the rota?', 'Remove', true))) return;
      await db.remove('shifts', b.dataset.del);
      await db.audit('Shift removed', { related: b.dataset.del });
      M.render();
    }));
  };

  /* ---- Patrols (routes + history) ---- */
  VIEWS.patrols = function (v) {
    const siteId = M.filters.routeSite || (db.all('sites')[0] || {}).id || '';
    const routes = siteId ? Q.routesForSite(siteId) : [];
    const f = M.filters.patrol = M.filters.patrol || { date: '', guard: '', route: '', status: '' };
    const rows = filterPatrols(f);
    v.innerHTML = card('Patrol routes',
      '<div class="toolbar"><label class="fld fld-inline"><span>Site</span><select id="rt-site">' + siteOptions(siteId) + '</select></label><button class="btn btn-primary" id="rt-add"' + (siteId ? '' : ' disabled') + '>Add route</button></div>' +
      table([
        { label: 'Route', html: (r) => '<b>' + esc(r.name) + '</b><small class="blk">' + esc(r.description || '') + '</small>' },
        { label: 'Checkpoints', html: (r) => { const c = Q.checkpointsForRoute(r.id); return c.length ? c.map((x) => esc(x.name)).join(' → ') : '<span class="amber-text">No checkpoints yet</span>'; } },
        { label: '', html: (r) => '<button class="btn btn-sm btn-secondary" data-cps="' + esc(r.id) + '">Checkpoints</button> <button class="btn btn-sm btn-ghost" data-edit="' + esc(r.id) + '">Edit</button>' },
      ], routes, siteId ? 'No routes for this site yet.' : 'Add a site first.')) +
      card('Patrol history',
        '<div class="filters">' +
        '<label class="fld fld-inline"><span>Date</span><input type="date" id="pf-date" value="' + esc(f.date) + '"></label>' +
        '<label class="fld fld-inline"><span>Guard</span><select id="pf-guard">' + guardOptions(f.guard, true) + '</select></label>' +
        '<label class="fld fld-inline"><span>Patrol</span><select id="pf-route">' + opt('', 'All patrols', f.route) + db.all('patrolRoutes').map((r) => opt(r.id, r.name, f.route)).join('') + '</select></label>' +
        '<label class="fld fld-inline"><span>Status</span><select id="pf-status">' + ['', 'Complete', 'Incomplete', 'Active', 'Paused'].map((s) => opt(s, s || 'All statuses', f.status)).join('') + '</select></label>' +
        '<button class="btn btn-sm btn-ghost" id="pf-clear">Clear</button><span class="grow"></span><button class="btn btn-sm btn-secondary" id="pf-csv">Export CSV</button></div>' +
        patrolTable(rows));
    U.$('#rt-site', v).onchange = (e) => { M.filters.routeSite = e.target.value; M.render(); };
    U.$('#rt-add', v).onclick = () => routeForm(null, siteId);
    v.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => routeForm(db.get('patrolRoutes', b.dataset.edit))));
    v.querySelectorAll('[data-cps]').forEach((b) => (b.onclick = () => { const r = db.get('patrolRoutes', b.dataset.cps); M.filters.cpSite = r.siteId; M.filters.cpRoute = r.id; location.hash = '#/manager/checkpoints'; }));
    ['date', 'guard', 'route', 'status'].forEach((k) => (U.$('#pf-' + k, v).onchange = (e) => { f[k] = e.target.value; M.render(); }));
    U.$('#pf-clear', v).onclick = () => { M.filters.patrol = null; M.render(); };
    U.$('#pf-csv', v).onclick = () => SW.exports.patrols(rows);
    bindPatrolRows(v);
  };
  function filterPatrols(f, siteIds) {
    return db.all('patrols').filter((p) => (!siteIds || siteIds.includes(p.siteId)) && (!f.date || U.ymd(p.startAt) === f.date) && (!f.guard || p.guardId === f.guard) && (!f.route || p.routeId === f.route) && (!f.status || p.status === f.status))
      .sort((a, b) => (a.startAt < b.startAt ? 1 : -1));
  }
  function patrolTable(rows) {
    return table([
      { label: 'Date', html: (p) => U.fmtShortDate(p.startAt) },
      { label: 'Guard', html: (p) => esc(Q.guardName(p.guardId)) },
      { label: 'Patrol', html: (p) => '<a href="#" data-pat="' + esc(p.id) + '">' + esc(Q.routeName(p.routeId)) + '</a><small class="blk">' + esc(p.id) + '</small>' },
      { label: 'Start', html: (p) => U.fmtTime(p.startAt) },
      { label: 'End', html: (p) => (p.endAt ? U.fmtTime(p.endAt) : '—') },
      { label: 'Checkpoints', html: (p) => { const pr = p.endAt ? { done: p.verified, total: p.total } : Q.patrolProgress(p); return pr.done + '/' + pr.total; } },
      { label: 'Completion', num: true, html: (p) => { const pr = p.endAt ? { done: p.verified, total: p.total } : Q.patrolProgress(p); return Math.round((pr.done / Math.max(1, pr.total)) * 100) + '%'; } },
      { label: 'Status', html: (p) => U.badge(p.status, U.statusCls(p.status)) },
      { label: 'Data', html: src },
    ], rows.slice(0, 300), 'No patrols match these filters.', { rowAttr: (p) => (p.status === 'Incomplete' ? 'class="row-warn"' : '') });
  }
  M.patrolTable = patrolTable; M.filterPatrols = filterPatrols;
  function bindPatrolRows(v) { v.querySelectorAll('[data-pat]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); patrolDetail(db.get('patrols', a.dataset.pat)); })); }
  M.bindPatrolRows = bindPatrolRows;

  function patrolDetail(p) {
    const scans = db.where('checkpointScans', (s) => s.patrolId === p.id).sort((a, b) => (a.at > b.at ? 1 : -1));
    U.modal({
      title: p.id + ' — ' + Q.routeName(p.routeId), wide: true,
      body: '<dl class="dl-grid"><dt>Guard</dt><dd>' + esc(Q.guardName(p.guardId)) + '</dd><dt>Site</dt><dd>' + esc(Q.siteName(p.siteId)) + '</dd><dt>Start</dt><dd>' + U.fmtDateTime(p.startAt) + '</dd><dt>End</dt><dd>' + U.fmtDateTime(p.endAt) + '</dd><dt>Duration</dt><dd>' + U.duration(Q.patrolElapsed(p)) + ' (excluding pauses)</dd><dt>Status</dt><dd>' + U.badge(p.status, U.statusCls(p.status)) + ' ' + src(p) + '</dd></dl>' +
        ((p.missed || []).length ? '<div class="alert alert-amber"><div><b>Missed:</b> ' + esc(p.missed.map((m) => m.name + (m.required ? '' : ' (optional)')).join(', ')) + (p.explanation ? '<br><b>Explanation (' + U.fmtDateTime(p.explanationAt) + '):</b> ' + esc(p.explanation) : '') + '</div></div>' : '') +
        ((p.pauses || []).length ? '<h3>Pauses</h3><ul>' + p.pauses.map((x) => '<li>' + U.fmtTime(x.start) + ' – ' + (x.end ? U.fmtTime(x.end) : 'ongoing') + ': ' + esc(x.reason || '') + '</li>').join('') + '</ul>' : '') +
        '<h3>Checkpoint scans</h3>' + table([
          { label: 'Time', html: (s) => U.fmtTimeSec(s.at) },
          { label: 'Checkpoint', html: (s) => esc((db.get('checkpoints', s.checkpointId) || {}).name || s.checkpointId || '—') },
          { label: 'Result', html: (s) => U.badge(s.status, U.statusCls(s.status)) },
          { label: 'Location', html: (s) => U.badge(s.locationStatus || '—', U.statusCls(s.locationStatus)) + (s.distance != null ? ' ' + s.distance + ' m' : '') },
          { label: 'GPS', html: (s) => esc(U.gpsLabel(s.gps)) },
          { label: 'Method', html: (s) => esc(s.method || '') },
        ], scans, 'No scans recorded.'),
      actions: [{ label: 'Close', cls: 'btn-primary', value: true }],
    });
  }

  async function routeForm(r, siteId) {
    const isNew = !r;
    r = r || { siteId };
    const res = await U.modal({
      title: isNew ? 'Add patrol route' : 'Edit route',
      body: '<label class="fld"><span>Route name *</span><input name="name" maxlength="80" value="' + esc(r.name || '') + '" placeholder="Patrol 1 — Ground Floor"></label><label class="fld"><span>Description</span><textarea name="description" rows="3" maxlength="300">' + esc(r.description || '') + '</textarea></label>',
      actions: [].concat(isNew ? [] : [{ label: 'Delete', cls: 'btn-danger-ghost', value: 'delete' }]).concat([{ label: 'Cancel', value: null }, {
        label: 'Save route', cls: 'btn-primary', onClick: async (m) => {
          const f = formData(m);
          if (U.clean(f.name).length < 2) return fieldErr(m, 'name', 'Enter a route name.');
          Object.assign(r, { name: U.clean(f.name, 80), description: U.clean(f.description, 300) });
          if (isNew) { r.id = SW.seq('patrolRoutes', 'R'); r.source = 'device'; }
          await db.put('patrolRoutes', r);
          await db.audit(isNew ? 'Patrol route created' : 'Patrol route updated', { siteId: r.siteId, subject: r.name, related: r.id });
          return 'saved';
        },
      }]),
    });
    if (res === 'delete') {
      if (db.where('patrols', (p) => p.routeId === r.id).length) { U.toast('This route has patrol history and cannot be deleted.', 'error', 5000); return; }
      if (!(await U.confirm('Delete route?', 'Delete ' + r.name + ' and its checkpoints?', 'Delete', true))) return;
      for (const c of Q.checkpointsForRoute(r.id)) await db.remove('checkpoints', c.id);
      await db.remove('patrolRoutes', r.id);
      await db.audit('Patrol route deleted', { siteId: r.siteId, subject: r.name });
    }
    if (res) M.render();
  }

  /* ---- Checkpoints + QR ---- */
  M.qrSvg = function (text, size) {
    if (!window.qrcode) return '<div class="qr-missing">QR library not loaded</div>';
    const q = window.qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    const cell = Math.max(2, Math.floor((size || 160) / (n + 8)));
    return q.createSvgTag({ cellSize: cell, margin: cell * 4, scalable: true, alt: 'Checkpoint QR code' });
  };

  VIEWS.checkpoints = function (v) {
    const siteId = M.filters.cpSite || (db.all('sites')[0] || {}).id || '';
    const routes = siteId ? Q.routesForSite(siteId) : [];
    let routeId = M.filters.cpRoute;
    if (!routes.some((r) => r.id === routeId)) routeId = (routes[0] || {}).id || '';
    const cps = routeId ? Q.checkpointsForRoute(routeId) : [];
    const recent = db.where('checkpointScans', (s) => !siteId || s.siteId === siteId).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 25);
    v.innerHTML = '<div class="toolbar">' +
      '<label class="fld fld-inline"><span>Site</span><select id="cp-site">' + siteOptions(siteId) + '</select></label>' +
      '<label class="fld fld-inline"><span>Route</span><select id="cp-route">' + routes.map((r) => opt(r.id, r.name, routeId)).join('') + '</select></label>' +
      '<span class="grow"></span><button class="btn btn-secondary" id="cp-print"' + (cps.length ? '' : ' disabled') + '>Print all QR codes</button><button class="btn btn-primary" id="cp-add"' + (routeId ? '' : ' disabled') + '>Add checkpoint</button></div>' +
      card('Checkpoints' + (routeId ? ' — ' + Q.routeName(routeId) : ''),
        cps.length ? '<div class="cp-grid">' + cps.map((c, i) => '<article class="cp-card"><div class="cp-qr">' + M.qrSvg(c.qr, 120) + '</div><div class="cp-info"><span class="cp-order">' + c.order + '</span><h3>' + esc(c.name) + '</h3><p class="mono-ish">' + esc(c.id) + '</p><p>' + esc(c.description || '') + '</p><p class="muted">' + (c.lat != null ? c.lat.toFixed(5) + ', ' + c.lng.toFixed(5) : 'No GPS set') + ' — ' + (c.required ? 'Required' : 'Optional') + '</p>' +
          '<div class="cp-act"><button class="btn btn-sm btn-secondary" data-print="' + esc(c.id) + '">Print QR code</button><button class="btn btn-sm btn-ghost" data-edit="' + esc(c.id) + '">Edit</button><button class="icon-btn" data-up="' + esc(c.id) + '" aria-label="Move up"' + (i === 0 ? ' disabled' : '') + '>↑</button><button class="icon-btn" data-down="' + esc(c.id) + '" aria-label="Move down"' + (i === cps.length - 1 ? ' disabled' : '') + '>↓</button></div></div></article>').join('') + '</div>'
          : '<div class="empty"><p>' + (routeId ? 'No checkpoints on this route yet. Add the first one.' : 'Create a patrol route for this site first (Patrols page).') + '</p></div>') +
      card('Recent checkpoint scans', table([
        { label: 'Date / time', html: (s) => U.fmtDateTime(s.at) },
        { label: 'Guard', html: (s) => esc(Q.guardName(s.guardId)) },
        { label: 'Checkpoint', html: (s) => esc((db.get('checkpoints', s.checkpointId) || {}).name || '—') },
        { label: 'Patrol', html: (s) => esc(s.patrolId || '—') },
        { label: 'Result', html: (s) => U.badge(s.status, U.statusCls(s.status)) },
        { label: 'Location', html: (s) => U.badge(s.locationStatus || '—', U.statusCls(s.locationStatus)) },
        { label: 'Data', html: src },
      ], recent, 'No scans yet.'), '<button class="btn btn-sm btn-secondary" id="sc-csv">Export CSV</button>');
    U.$('#cp-site', v).onchange = (e) => { M.filters.cpSite = e.target.value; M.filters.cpRoute = ''; M.render(); };
    const rsel = U.$('#cp-route', v); if (rsel) rsel.onchange = (e) => { M.filters.cpRoute = e.target.value; M.render(); };
    U.$('#cp-add', v).onclick = () => cpForm(null, siteId, routeId);
    U.$('#cp-print', v).onclick = () => printQr(cps);
    U.$('#sc-csv', v).onclick = () => SW.exports.scans();
    v.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => cpForm(db.get('checkpoints', b.dataset.edit))));
    v.querySelectorAll('[data-print]').forEach((b) => (b.onclick = () => printQr([db.get('checkpoints', b.dataset.print)])));
    const move = async (id, dir) => {
      const list = Q.checkpointsForRoute(routeId);
      const i = list.findIndex((c) => c.id === id), j = i + dir;
      if (j < 0 || j >= list.length) return;
      [list[i].order, list[j].order] = [list[j].order, list[i].order];
      await db.put('checkpoints', list[i]); await db.put('checkpoints', list[j]);
      M.render();
    };
    v.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => move(b.dataset.up, -1)));
    v.querySelectorAll('[data-down]').forEach((b) => (b.onclick = () => move(b.dataset.down, 1)));
  };

  function nextCpId() { let n = 0; db.all('checkpoints').forEach((c) => { const m = /^CP-(\d+)$/.exec(c.id); if (m) n = Math.max(n, +m[1]); }); return 'CP-' + String(n + 1).padStart(3, '0'); }

  async function cpForm(c, siteId, routeId) {
    const isNew = !c;
    c = c || { siteId, routeId, required: true };
    const res = await U.modal({
      title: isNew ? 'Add checkpoint' : 'Edit ' + c.name, wide: true,
      body: '<div class="form-grid">' +
        '<label class="fld"><span>Checkpoint ID</span><input name="id" value="' + esc(c.id || nextCpId()) + '"' + (isNew ? '' : ' readonly') + ' maxlength="20"></label>' +
        '<label class="fld"><span>Name *</span><input name="name" maxlength="80" value="' + esc(c.name || '') + '" placeholder="Main Entrance"></label>' +
        '<label class="fld span2"><span>Description / what to check</span><textarea name="description" rows="2" maxlength="300">' + esc(c.description || '') + '</textarea></label>' +
        '<label class="fld"><span>Latitude</span><input name="lat" inputmode="decimal" value="' + esc(c.lat != null ? c.lat : '') + '"></label>' +
        '<label class="fld"><span>Longitude</span><input name="lng" inputmode="decimal" value="' + esc(c.lng != null ? c.lng : '') + '"></label>' +
        '<div class="span2"><button type="button" class="btn btn-sm btn-secondary" id="use-loc">Use my current location</button> <span class="muted" id="loc-msg">Stand at the checkpoint for best accuracy.</span></div>' +
        '<label class="fld chk span2"><input type="checkbox" name="required"' + (c.required ? ' checked' : '') + '><span>Required — patrol is incomplete if this checkpoint is missed</span></label>' +
        (isNew ? '' : '<label class="fld chk span2"><input type="checkbox" name="regen"><span>Generate a new QR code (old printed codes will stop working)</span></label>') +
        '<p class="muted span2">QR value: <span class="mono-ish">' + esc(c.qr || 'created when saved') + '</span></p>' +
        '</div>',
      onOpen: (m) => {
        m.querySelector('#use-loc').onclick = async () => {
          const msg = m.querySelector('#loc-msg'); msg.textContent = 'Locating…';
          const g = await U.getGPS({ maxAge: 0 });
          if (g.ok) { m.querySelector('[name=lat]').value = g.lat; m.querySelector('[name=lng]').value = g.lng; msg.textContent = 'Set (±' + g.accuracy + ' m)'; }
          else msg.textContent = g.error;
        };
      },
      actions: [].concat(isNew ? [] : [{ label: 'Delete', cls: 'btn-danger-ghost', value: 'delete' }]).concat([{ label: 'Cancel', value: null }, {
        label: 'Save checkpoint', cls: 'btn-primary', onClick: async (m) => {
          const f = formData(m);
          const id = U.clean(f.id, 20).toUpperCase();
          if (isNew && !/^[A-Z0-9-]{2,20}$/.test(id)) return fieldErr(m, 'id', 'ID can use letters, numbers and dashes only.');
          if (isNew && db.get('checkpoints', id)) return fieldErr(m, 'id', 'That checkpoint ID is already in use.');
          if (U.clean(f.name).length < 2) return fieldErr(m, 'name', 'Enter a checkpoint name.');
          const lat = f.lat === '' ? null : Number(f.lat), lng = f.lng === '' ? null : Number(f.lng);
          if ((lat === null) !== (lng === null) || (lat !== null && (isNaN(lat) || Math.abs(lat) > 90 || isNaN(lng) || Math.abs(lng) > 180))) return fieldErr(m, 'lat', 'Enter both coordinates as decimal numbers, or leave both empty.');
          Object.assign(c, { name: U.clean(f.name, 80), description: U.clean(f.description, 300), lat, lng, required: !!f.required });
          if (isNew) { c.id = id; c.order = Q.checkpointsForRoute(c.routeId).length + 1; c.source = 'device'; }
          if (isNew || f.regen) c.qr = 'SECUREWATCH:' + c.siteId + ':' + c.id + ':' + U.token(6);
          await db.put('checkpoints', c);
          await db.audit(isNew ? 'Checkpoint created' : 'Checkpoint updated', { siteId: c.siteId, subject: c.name, related: c.id });
          return 'saved';
        },
      }]),
    });
    if (res === 'delete') {
      if (!(await U.confirm('Delete checkpoint?', 'Delete ' + c.name + '? Past scans are kept.', 'Delete', true))) return;
      await db.remove('checkpoints', c.id);
      Q.checkpointsForRoute(c.routeId).forEach((x, i) => { x.order = i + 1; db.put('checkpoints', x); });
      await db.audit('Checkpoint deleted', { siteId: c.siteId, subject: c.name });
    }
    if (res) M.render();
  }

  function printQr(cps) {
    const html = '<div class="qr-sheet">' + cps.map((c) => '<div class="qr-label"><p class="ql-site">' + esc(Q.siteName(c.siteId)) + '</p><div class="ql-code">' + M.qrSvg(c.qr, 240) + '</div><h2>' + esc(c.name) + '</h2><p class="ql-id">' + esc(c.id) + '</p><p class="ql-foot">SecureWatch checkpoint — scan with the guard app</p></div>').join('') + '</div>';
    SW.app.print(html, 'QR codes');
  }

  /* ---- Incidents ---- */
  VIEWS.incidents = function (v) {
    const f = M.filters.inc = M.filters.inc || { status: '', severity: '', type: '', site: '' };
    const rows = db.all('incidents').filter((i) => (!f.status || i.status === f.status) && (!f.severity || i.severity === f.severity) && (!f.type || i.type === f.type) && (!f.site || i.siteId === f.site)).sort((a, b) => (a.at < b.at ? 1 : -1));
    v.innerHTML = card('Incident reports (' + rows.length + ')',
      '<div class="filters">' +
      '<label class="fld fld-inline"><span>Status</span><select id="if-status">' + ['', 'Open', 'Under Review', 'Resolved'].map((s) => opt(s, s || 'All', f.status)).join('') + '</select></label>' +
      '<label class="fld fld-inline"><span>Severity</span><select id="if-severity">' + [''].concat(SW.guard.SEV).map((s) => opt(s, s || 'All', f.severity)).join('') + '</select></label>' +
      '<label class="fld fld-inline"><span>Type</span><select id="if-type">' + [''].concat(SW.guard.TYPES).map((s) => opt(s, s || 'All', f.type)).join('') + '</select></label>' +
      '<label class="fld fld-inline"><span>Site</span><select id="if-site">' + siteOptions(f.site, true) + '</select></label>' +
      '<span class="grow"></span><button class="btn btn-sm btn-secondary" id="if-csv">Export CSV</button></div>' + incidentTable(rows, true));
    ['status', 'severity', 'type', 'site'].forEach((k) => (U.$('#if-' + k, v).onchange = (e) => { f[k] = e.target.value; M.render(); }));
    U.$('#if-csv', v).onclick = () => SW.exports.incidents(rows);
    bindInc(v, true);
  };
  function incidentTable(rows) {
    return table([
      { label: 'Incident ID', html: (r) => '<a href="#" data-inc="' + esc(r.id) + '"><b>' + esc(r.id) + '</b></a>' },
      { label: 'Date', html: (r) => U.fmtDate(r.at) },
      { label: 'Time', html: (r) => U.fmtTime(r.at) },
      { label: 'Guard', html: (r) => esc(Q.guardName(r.guardId)) },
      { label: 'Site', html: (r) => esc(Q.siteName(r.siteId)) },
      { label: 'Type', html: (r) => esc(r.type) },
      { label: 'Severity', html: (r) => U.badge(r.severity, U.statusCls(r.severity)) },
      { label: 'Description', html: (r) => '<span class="clip">' + esc(r.description) + '</span>' },
      { label: 'Evidence', html: (r) => ((r.media || []).length ? r.media.length + ' file(s)' : '—') },
      { label: 'Status', html: (r) => U.badge(r.status, U.statusCls(r.status)) },
      { label: 'Data', html: src },
    ], rows, 'No incidents match.');
  }
  M.incidentTable = incidentTable;
  function bindInc(v, canEdit) { v.querySelectorAll('[data-inc]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); incidentDetail(db.get('incidents', a.dataset.inc), canEdit); })); }
  M.bindInc = bindInc;

  async function incidentDetail(inc, canEdit) {
    revokeMedia();
    const res = await U.modal({
      title: inc.id + ' — ' + inc.type, wide: true,
      body: '<dl class="dl-grid">' +
        '<dt>Date / time</dt><dd>' + U.fmtDateTime(inc.at) + '</dd>' +
        '<dt>Guard</dt><dd>' + esc(Q.guardName(inc.guardId)) + '</dd>' +
        '<dt>Site</dt><dd>' + esc(Q.siteName(inc.siteId)) + (inc.locationNote ? ' — ' + esc(inc.locationNote) : '') + '</dd>' +
        '<dt>Severity</dt><dd>' + U.badge(inc.severity, U.statusCls(inc.severity)) + '</dd>' +
        '<dt>GPS location</dt><dd>' + esc(U.gpsLabel(inc.gps)) + (U.mapLink(inc.gps) ? ' <a href="' + U.mapLink(inc.gps) + '" target="_blank" rel="noopener">Open map</a>' : '') + '</dd>' +
        '<dt>Witness</dt><dd>' + esc(inc.witness || '—') + '</dd>' +
        '<dt>Police contacted</dt><dd>' + esc(inc.police) + '</dd>' +
        '<dt>Emergency services</dt><dd>' + esc(inc.emergency) + '</dd>' +
        '<dt>Data</dt><dd>' + src(inc) + '</dd></dl>' +
        '<h3>Description</h3><p class="pre">' + esc(inc.description) + '</p>' +
        '<h3>Evidence</h3><div id="inc-media" class="inc-media">' + ((inc.media || []).length ? '<p class="muted">Loading files…</p>' : '<p class="muted">No photos, video or audio attached.</p>') + '</div>' +
        '<h3>Status history</h3><ul class="feed">' + (inc.statusHistory || []).map((h) => '<li><time>' + U.fmtDateTime(h.at) + '</time><div><b>' + esc(h.status) + '</b> by ' + esc(h.by) + (h.note ? '<small>' + esc(h.note) + '</small>' : '') + '</div></li>').join('') + '</ul>' +
        (canEdit ? '<div class="form-grid"><label class="fld"><span>Change status</span><select name="status">' + ['Open', 'Under Review', 'Resolved'].map((s) => opt(s, s, inc.status)).join('') + '</select></label><label class="fld"><span>Note (optional)</span><input name="note" maxlength="500"></label></div>' : ''),
      onOpen: async (m) => {
        const host = m.querySelector('#inc-media');
        if (!(inc.media || []).length) return;
        let html = '';
        for (const md of inc.media) {
          const rec = await db.getMedia(md.id);
          if (!rec) { html += '<p class="muted">' + esc(md.name) + ' — file not on this device</p>'; continue; }
          const url = URL.createObjectURL(rec.blob); M.mediaUrls.push(url);
          if (md.kind === 'photo') html += '<figure><a href="' + url + '" target="_blank" rel="noopener"><img src="' + url + '" alt="Incident photo ' + esc(md.name) + '"></a><figcaption>' + esc(md.name) + '</figcaption></figure>';
          else if (md.kind === 'video') html += '<figure><video src="' + url + '" controls preload="metadata"></video><figcaption>' + esc(md.name) + '</figcaption></figure>';
          else html += '<figure><audio src="' + url + '" controls></audio><figcaption>' + esc(md.name) + '</figcaption></figure>';
        }
        host.innerHTML = html;
      },
      actions: canEdit ? [{ label: 'Close', value: null }, { label: 'Save status', cls: 'btn-primary', onClick: (m) => formData(m) }] : [{ label: 'Close', cls: 'btn-primary', value: null }],
    });
    revokeMedia();
    if (res && (res.status !== inc.status || res.note)) {
      await OPS.setIncidentStatus(inc, res.status, res.note);
      U.toast(inc.id + ' set to ' + res.status, 'ok');
      M.render();
    }
  }
  M.incidentDetail = incidentDetail;

  /* ---- Welfare ---- */
  VIEWS.welfare = function (v) {
    const s = db.settings();
    const f = M.filters.wel = M.filters.wel || { status: '' };
    const rows = db.all('welfareChecks').filter((w) => !f.status || w.status === f.status).sort((a, b) => ((a.at || a.dueAt) < (b.at || b.dueAt) ? 1 : -1));
    const sos = db.all('sosEvents').slice().sort((a, b) => (a.at < b.at ? 1 : -1));
    v.innerHTML = alertsHtml(null, true) +
      card('Welfare check settings',
        '<form id="wf-form" class="form-grid form-inline"><label class="fld"><span>Default interval (minutes)</span><input type="number" name="welfareInterval" min="10" max="240" value="' + s.welfareInterval + '"></label>' +
        '<label class="fld"><span>Grace period before missed (minutes)</span><input type="number" name="welfareGrace" min="1" max="60" value="' + s.welfareGrace + '"></label>' +
        '<div class="fld fld-btn"><button class="btn btn-primary">Save settings</button></div></form>' +
        '<p class="muted">Each shift can set its own interval on the Shifts page. The guard app prompts the guard when a check is due. If it is not confirmed within the grace period it is recorded as missed and shown here. No SMS, email or call is sent — there is no notification service in this prototype.</p>') +
      card('Welfare checks', '<div class="filters"><label class="fld fld-inline"><span>Status</span><select id="wf-st">' + ['', 'Confirmed', 'Missed'].map((x) => opt(x, x || 'All', f.status)).join('') + '</select></label><span class="grow"></span><button class="btn btn-sm btn-secondary" id="wf-csv">Export CSV</button></div>' +
        table([
          { label: 'Date', html: (w) => U.fmtDate(w.at || w.dueAt) },
          { label: 'Guard', html: (w) => esc(Q.guardName(w.guardId)) },
          { label: 'Site', html: (w) => esc(Q.siteName(w.siteId)) },
          { label: 'Due', html: (w) => (w.dueAt ? U.fmtTime(w.dueAt) : 'Early') },
          { label: 'Confirmed', html: (w) => (w.at ? U.fmtTime(w.at) : '—') },
          { label: 'Status', html: (w) => U.badge(w.status, U.statusCls(w.status)) },
          { label: 'GPS', html: (w) => esc(U.gpsLabel(w.gps)) },
          { label: 'Data', html: src },
        ], rows.slice(0, 300), 'No welfare checks recorded yet.')) +
      card('SOS events', table([
        { label: 'ID', html: (e) => esc(e.id) },
        { label: 'Date / time', html: (e) => U.fmtDateTime(e.at) },
        { label: 'Guard', html: (e) => esc(Q.guardName(e.guardId)) },
        { label: 'Site', html: (e) => esc(Q.siteName(e.siteId)) },
        { label: 'GPS', html: (e) => esc(U.gpsLabel(e.gps)) + (U.mapLink(e.gps) ? ' <a href="' + U.mapLink(e.gps) + '" target="_blank" rel="noopener">Map</a>' : '') },
        { label: 'Status', html: (e) => U.badge(e.status, e.status === 'Active' ? 'red' : U.statusCls(e.status)) + (e.ackBy ? '<small class="blk">Ack ' + U.fmtTime(e.ackAt) + ' ' + esc(e.ackBy) + '</small>' : '') },
        { label: '', html: (e) => (e.status !== 'Resolved' ? (e.status === 'Active' ? '<button class="btn btn-sm btn-secondary" data-sos="' + esc(e.id) + '" data-st="Acknowledged">Acknowledge</button> ' : '') + '<button class="btn btn-sm btn-secondary" data-sos="' + esc(e.id) + '" data-st="Resolved">Resolve</button>' : '') },
      ], sos, 'No SOS events.'));
    U.$('#wf-form', v).onsubmit = async (e) => {
      e.preventDefault();
      const fd = formData(e.target);
      const wi = +fd.welfareInterval, wg = +fd.welfareGrace;
      if (!(wi >= 10 && wi <= 240) || !(wg >= 1 && wg <= 60)) return U.toast('Interval 10–240 and grace 1–60 minutes.', 'error');
      await db.saveSettings({ welfareInterval: wi, welfareGrace: wg });
      await db.audit('Welfare settings changed', { subject: 'Every ' + wi + ' min, grace ' + wg + ' min' });
      U.toast('Welfare settings saved', 'ok');
    };
    U.$('#wf-st', v).onchange = (e) => { f.status = e.target.value; M.render(); };
    U.$('#wf-csv', v).onclick = () => SW.exports.welfare(rows);
    bindSos(v);
  };

  /* ---- Reports ---- */
  VIEWS.reports = function (v) {
    v.innerHTML = card('Security reports', '<div id="rp-host"></div>') +
      card('Data exports (CSV for Excel)', '<div class="export-grid">' +
        [['patrols', 'Patrol history'], ['scans', 'Checkpoint scans'], ['incidents', 'Incident reports'], ['attendance', 'Attendance (clock in/out)'], ['welfare', 'Welfare checks'], ['audit', 'Audit log']].map((x) => '<button class="btn btn-secondary" data-csv="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>');
    SW.reports.panel(U.$('#rp-host', v), { guards: true });
    v.querySelectorAll('[data-csv]').forEach((b) => (b.onclick = () => SW.exports[b.dataset.csv]()));
  };
  function defaultReportDate() {
    const last = db.where('shifts', (s) => s.status === 'Completed').sort((a, b) => (a.startAt < b.startAt ? 1 : -1))[0];
    return last ? last.date : U.today();
  }
  M.defaultReportDate = defaultReportDate;

  /* ---- Client portal preview ---- */
  VIEWS.client = function (v) {
    v.innerHTML = '<div class="note-box">This is a preview of what a client sees when signing in with the demo <b>client</b> login. Clients can view but not change anything.</div><div id="cp-host"></div>';
    SW.client.render(U.$('#cp-host', v), null, true);
  };

  /* ---- Settings ---- */
  VIEWS.settings = function (v) {
    const s = db.settings();
    const pend = db.pending().length;
    v.innerHTML = card('General',
      '<form id="st-form" class="form-grid">' +
      '<label class="fld"><span>Company name (shown on reports)</span><input name="companyName" maxlength="80" value="' + esc(s.companyName) + '"></label>' +
      '<label class="fld"><span>Default patrol frequency (minutes)</span><input type="number" name="patrolFrequency" min="15" max="720" value="' + s.patrolFrequency + '"></label>' +
      '<label class="fld"><span>Checkpoint GPS tolerance (metres)</span><input type="number" name="gpsRadius" min="10" max="1000" value="' + s.gpsRadius + '"></label>' +
      '<label class="fld"><span>Licence "expiring soon" warning (days)</span><input type="number" name="licenceWarnDays" min="7" max="180" value="' + s.licenceWarnDays + '"></label>' +
      '<label class="fld chk span2"><input type="checkbox" name="demoMode"' + (s.demoMode ? ' checked' : '') + '><span>Training mode — shows a banner and a "simulate scan" button in the guard app (turn off for real shifts)</span></label>' +
      '<div class="span2"><button class="btn btn-primary">Save settings</button></div></form>') +
      card('Data on this device',
        '<dl class="dl-grid"><dt>Storage</dt><dd>' + (db.mode === 'indexeddb' ? 'IndexedDB (records and media)' : 'localStorage fallback — photos, video and audio cannot be saved') + '</dd>' +
        '<dt>Sync</dt><dd>' + esc(SW.syncAdapter.name) + ' — ' + pend + ' record(s) waiting from offline use</dd>' +
        '<dt>Records</dt><dd>' + ['shifts', 'patrols', 'checkpointScans', 'incidents', 'welfareChecks', 'auditLogs'].map((k) => db.all(k).length + ' ' + k).join(', ') + '</dd></dl>' +
        '<div class="btn-row"><button class="btn btn-secondary" id="bk-exp">Download data backup (JSON)</button><label class="btn btn-secondary file-btn">Import data file<input type="file" accept="application/json,.json" id="bk-imp" hidden></label><button class="btn btn-danger-ghost" id="dm-wipe">Erase all data on this device</button></div>' +
        '<p class="muted">To move a guard\u2019s records to this computer: on the guard phone open <i>More › Send my data to a manager</i>, send the file to yourself, then import it here. Imported records are merged; existing records with the same ID are updated.</p>') +
      (SW.remote.enabled
        ? card('Logins', '<div id="login-mgr"><p class="muted">Loading logins…</p></div>') +
          card('Email notifications', '<div id="mail-mgr"><p class="muted">Loading…</p></div>') +
          card('Server sync', '<dl class="dl-grid"><dt>Server</dt><dd>Supabase — London (UK)</dd><dt>Last sync</dt><dd>' + (SW.remote.lastSync ? U.fmtDateTime(SW.remote.lastSync) + ' (' + U.minsLabel(Date.now() - SW.remote.lastSync) + ')' : 'Not yet') + '</dd><dt>Waiting to upload</dt><dd>' + db.pending().length + ' change(s)</dd>' + (SW.remote.lastError ? '<dt>Last problem</dt><dd class="red-text">' + esc(SW.remote.lastError) + '</dd>' : '') + '</dl><div class="btn-row"><button class="btn btn-primary" id="sync-now">Sync now</button></div><p class="muted">Every device syncs automatically about every 20 seconds while it is online. Changes made offline upload when the signal returns.</p>')
        : card('Logins', '<div id="login-mgr"></div>') +
      card('Publish setup to all devices',
        '<p>Phones and computers each keep their own copy of the data. To send the site, guards, rota, checkpoints and logins from <b>this computer</b> to every device, download <b>config.js</b> and upload it to GitHub, replacing the old file. Every device updates the next time SecureWatch is opened online.</p>' +
        '<div class="btn-row"><button class="btn btn-primary" id="pub-cfg">Download config.js</button></div>' +
        '<p class="muted">Current setup version: ' + esc((window.SW_CONFIG || {}).version || '—') + '. Shift progress, patrols, scans and incidents are never overwritten.</p>')) +
      card('Privacy notice', SW.app.privacyHtml());
    U.$('#st-form', v).onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const pf = +f.patrolFrequency, gr = +f.gpsRadius, lw = +f.licenceWarnDays;
      if (!(pf >= 15 && pf <= 720) || !(gr >= 10 && gr <= 1000) || !(lw >= 7 && lw <= 180)) return U.toast('Check the number ranges.', 'error');
      await db.saveSettings({ companyName: U.clean(f.companyName, 80) || 'SecureWatch', patrolFrequency: pf, gpsRadius: gr, licenceWarnDays: lw, demoMode: !!f.demoMode });
      await db.audit('Settings changed');
      U.toast('Settings saved', 'ok');
      SW.app.route();
    };
    U.$('#bk-exp', v).onclick = () => SW.app.exportBackup(false);
    U.$('#bk-imp', v).onchange = (e) => SW.app.importBackup(e.target.files[0]);
    if (SW.remote.enabled) {
      renderLoginsRemote(U.$('#login-mgr', v));
      renderMail(U.$('#mail-mgr', v));
      U.$('#sync-now', v).onclick = async (e) => { e.target.disabled = true; e.target.textContent = 'Syncing…'; await SW.app.syncNow(); U.toast(SW.remote.lastError ? 'Sync problem: ' + SW.remote.lastError : 'Synced with the server', SW.remote.lastError ? 'error' : 'ok'); M.render(); };
    } else {
      U.$('#pub-cfg', v).onclick = publishConfig;
      renderLogins(U.$('#login-mgr', v));
    }
    U.$('#dm-wipe', v).onclick = async () => {
      if (!(await U.confirm('Erase all data?', 'This deletes every record and file on this device and signs you out. The site, guards and rota from config.js are reloaded.', 'Erase everything', true))) return;
      if (SW.remote.enabled) { await db.clearAll(); SW.remote.resetCursor(); await SW.remote.pull(); U.toast('Local copy erased and downloaded again from the server', 'ok'); M.render(); return; }
      await SW.auth.logout(); await db.clearAll(); await SW.setup.apply(true); location.hash = '#/login'; location.reload();
    };
  };

  /* ---- Logins (edited here, published in config.js) ---- */
  function draftUsers() {
    const d = db.settings().usersDraft;
    return Array.isArray(d) ? d : SW.auth.users().map((u) => Object.assign({}, u));
  }
  async function saveDraft(list) { await db.saveSettings({ usersDraft: list }); }
  function genPassword() {
    const w = ['Amber', 'Birch', 'Cedar', 'Delta', 'Ember', 'Falcon', 'Granite', 'Harbour', 'Indigo', 'Juniper', 'Kestrel', 'Lantern', 'Meadow', 'Nimbus', 'Orchid', 'Pebble', 'Quartz', 'Raven', 'Summit', 'Thistle', 'Willow', 'Zephyr'];
    const r = crypto.getRandomValues(new Uint32Array(3));
    return w[r[0] % w.length] + '-' + w[r[1] % w.length] + '-' + (10 + (r[2] % 90));
  }
  function renderLogins(host) {
    const list = draftUsers();
    const changed = JSON.stringify(list) !== JSON.stringify(SW.auth.users());
    host.innerHTML = (changed ? '<div class="alert alert-amber"><div><b>Login changes not published yet.</b> Download config.js below and upload it to GitHub to apply them on every device.</div></div>' : '') +
      table([
        { label: 'Username', html: (u) => '<b>' + esc(u.username) + '</b>' },
        { label: 'Name', html: (u) => esc(u.displayName || '') },
        { label: 'Role', html: (u) => esc(u.role) + (u.guardId ? '<small class="blk">' + esc(Q.guardName(u.guardId)) + '</small>' : '') },
        { label: '', html: (u) => '<button class="btn btn-sm btn-secondary" data-pw="' + esc(u.username) + '">New password</button> <button class="btn btn-sm btn-danger-ghost" data-rm="' + esc(u.username) + '">Remove</button>' },
      ], list, 'No logins.') +
      '<div class="btn-row"><button class="btn btn-secondary" id="lg-add">Add login</button></div>' +
      '<p class="muted">Passwords are stored only as secure hashes, so they cannot be shown again. Note them down when you create them.</p>';
    U.$('#lg-add', host).onclick = () => loginForm(host);
    host.querySelectorAll('[data-pw]').forEach((b) => (b.onclick = async () => {
      const l = draftUsers(); const u = l.find((x) => x.username === b.dataset.pw);
      const pw = genPassword();
      Object.assign(u, await hashFor(pw));
      await saveDraft(l);
      await U.modal({ title: 'New password for ' + u.username, body: '<p>Give this password to ' + esc(u.displayName) + ':</p><p class="pw-show">' + esc(pw) + '</p><p class="muted">It starts working after you publish config.js.</p>', actions: [{ label: 'Done', cls: 'btn-primary' }] });
      renderLogins(host);
    }));
    host.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      if (b.dataset.rm === SW.session.username) return U.toast('You cannot remove the login you are using.', 'error');
      if (!(await U.confirm('Remove login?', 'Remove ' + b.dataset.rm + '? It stops working after you publish config.js.', 'Remove', true))) return;
      await saveDraft(draftUsers().filter((x) => x.username !== b.dataset.rm));
      renderLogins(host);
    }));
  }
  async function renderMail(host) {
    let m;
    try { m = await SW.remote.mailSettings(); }
    catch (e) { host.innerHTML = '<p class="red-text">' + esc(/function|does not exist|schema/i.test(e.message) ? 'Run 04-upgrade.sql in Supabase to turn on email features.' : e.message) + '</p>'; return; }
    const pop = 'Notification' in window ? Notification.permission : 'unsupported';
    host.innerHTML =
      '<form id="mail-form" class="form-grid"><label class="fld span2"><span>Send alerts to (comma-separate several emails)</span><input name="emails" maxlength="500" value="' + esc(m.alert_emails || '') + '" placeholder="you@gmail.com, manager@crystalservices.uk.com"></label>' +
      '<label class="fld span2"><span>App link used in emails</span><input name="url" maxlength="200" value="' + esc(m.app_url || '') + '"></label>' +
      '<div class="span2 btn-row"><button class="btn btn-primary">Save</button><button type="button" class="btn btn-secondary" id="mail-test">Send test email</button><button type="button" class="btn btn-secondary" id="pop-on">' + (pop === 'granted' ? '🔔 Pop-up alerts on (this device)' : 'Turn on pop-up alerts on this device') + '</button></div></form>' +
      '<p class="muted">Alerts are emailed for: SOS, missed welfare checks, High/Critical incidents and incomplete patrols. Emails waiting to send: <b>' + m.waiting + '</b>' + (m.last_sent ? ' · last sent ' + U.fmtDateTime(m.last_sent) : ' · nothing sent yet') + '.</p>' +
      '<details class="mail-key"><summary>Gmail sender set-up (mail key)</summary><p>Emails are sent from your Gmail by the Google Apps Script. Add this key in the script\u2019s Script properties as <code>MAILER_SECRET</code>, then run <b>setupMailer</b> once.</p><p class="pw-show small">' + esc(m.mailer_secret) + '</p><p class="muted">Keep this key private.</p></details>';
    U.$('#mail-form', host).onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      const bad = f.emails.split(',').map((x) => x.trim()).filter(Boolean).filter((x) => !U.validEmail(x));
      if (bad.length) return U.toast('Check this email: ' + bad[0], 'error');
      try { await SW.remote.saveMailSettings(f.emails, f.url); U.toast('Email settings saved', 'ok'); await db.audit('Email settings changed'); } catch (err) { U.toast(err.message, 'error'); }
    };
    U.$('#mail-test', host).onclick = async () => { try { await SW.remote.sendTestMail(); U.toast('Test email queued. It arrives within about a minute if the Gmail sender is running.', 'ok', 6000); renderMail(host); } catch (err) { U.toast(err.message, 'error'); } };
    U.$('#pop-on', host).onclick = async () => { await SW.app.enableAlerts(); renderMail(host); };
  }
  async function renderLoginsRemote(host) {
    let list;
    try { list = await SW.remote.listLogins(); }
    catch (e) { host.innerHTML = '<p class="red-text">Could not load logins: ' + esc(e.message) + (navigator.onLine ? '' : ' (you are offline)') + '</p>'; return; }
    host.innerHTML = table([
        { label: 'Username', html: (u) => '<b>' + esc(u.username) + '</b>' },
        { label: 'Name', html: (u) => esc(u.display_name || '') },
        { label: 'Role', html: (u) => esc(u.role) + (u.guard_id ? '<small class="blk">' + esc(Q.guardName(u.guard_id)) + '</small>' : '') },
        { label: 'Email', html: (u) => (u.email ? esc(u.email) : '<span class="muted">None</span>') + ' <button class="link-btn link-dark" data-em="' + esc(u.username) + '" data-cur="' + esc(u.email || '') + '">Edit</button>' },
        { label: 'Last sign-in', html: (u) => (u.last_sign_in_at ? U.fmtDateTime(u.last_sign_in_at) : '—') },
        { label: '', html: (u) => '<button class="btn btn-sm btn-secondary" data-pw="' + esc(u.username) + '" data-has="' + (u.email ? '1' : '') + '">New password</button> ' + (u.username === SW.session.username ? '' : '<button class="btn btn-sm btn-danger-ghost" data-rm="' + esc(u.username) + '">Remove</button>') },
      ], list || [], 'No logins.') +
      '<div class="btn-row"><button class="btn btn-secondary" id="lg-add">Add login</button></div>' +
      '<p class="muted">Changes take effect straight away on every device. With an email saved, people can use "Forgot password?" on the sign-in screen and receive login details by email (needs the Gmail sender — see Email notifications).</p>';
    U.$('#lg-add', host).onclick = async () => {
      const pw0 = genPassword();
      const res = await U.modal({
        title: 'Add login',
        body: '<div class="form-grid"><label class="fld"><span>Role</span><select name="role"><option value="guard">Guard</option><option value="manager">Manager</option><option value="client">Client (read only)</option></select></label>' +
          '<label class="fld"><span>Guard (for guard logins)</span><select name="guardId">' + opt('', '—') + db.all('guards').map((g) => opt(g.id, g.name)).join('') + '</select></label>' +
          '<label class="fld"><span>Username</span><input name="username" maxlength="40" autocomplete="off" autocapitalize="none"></label>' +
          '<label class="fld"><span>Display name</span><input name="displayName" maxlength="60"></label>' +
          '<label class="fld"><span>Password (at least 10 characters)</span><input name="password" maxlength="100" value="' + esc(pw0) + '" autocomplete="off"></label>' +
          '<label class="fld"><span>Email (for password reset and notices)</span><input name="email" type="email" maxlength="120" autocomplete="off"></label>' +
          '<label class="fld chk span2"><input type="checkbox" name="send" checked><span>Email the username and password to this person</span></label></div>',
        actions: [{ label: 'Cancel', value: null }, { label: 'Add login', cls: 'btn-primary', onClick: async (m) => {
          const f = formData(m);
          const username = U.clean(f.username, 40).toLowerCase();
          if (!/^[a-z0-9._-]{3,40}$/.test(username)) return fieldErr(m, 'username', 'Use 3–40 letters, numbers, dots or dashes.');
          if (f.role === 'guard' && !f.guardId) return fieldErr(m, 'guardId', 'Choose which guard this login is for.');
          if ((f.password || '').length < 10) return fieldErr(m, 'password', 'Use at least 10 characters.');
          const g = f.guardId ? db.get('guards', f.guardId) : null;
          try {
            if (f.email && !U.validEmail(f.email)) return fieldErr(m, 'email', 'That email address does not look right.');
            await SW.remote.createLogin({ p_username: username, p_password: f.password, p_role: f.role, p_display: U.clean(f.displayName, 60) || (g ? g.name : username), p_guard: f.role === 'guard' ? f.guardId : null, p_sites: f.role === 'manager' ? [] : db.all('sites').map((x) => x.id), p_email: U.clean(f.email, 120), p_send: !!(f.send && f.email) });
          } catch (e) { return fieldErr(m, 'username', e.message); }
          return { username, pw: f.password, mailed: !!(f.send && f.email) };
        } }],
      });
      if (res) { await db.audit('Login created', { subject: res.username }); await U.modal({ title: 'Login added', body: '<p>Username: <b>' + esc(res.username) + '</b></p><p class="pw-show">' + esc(res.pw) + '</p><p class="muted">' + (res.mailed ? 'The login details are also being emailed to them. ' : '') + 'Note this password now — it cannot be shown again.</p>', actions: [{ label: 'Done', cls: 'btn-primary' }] }); }
      renderLoginsRemote(host);
    };
    host.querySelectorAll('[data-pw]').forEach((b) => (b.onclick = async () => {
      const go = await U.modal({ title: 'New password for ' + b.dataset.pw, body: '<p>A new password will be created. The old one stops working immediately and the person is signed out.</p>' + (b.dataset.has ? '<label class="fld chk"><input type="checkbox" name="notify" checked><span>Email the new password to them</span></label>' : '<p class="muted">No email saved for this login, so give them the password yourself.</p>'),
        actions: [{ label: 'Cancel', value: null }, { label: 'Create password', cls: 'btn-primary', onClick: (m) => ({ notify: !!(m.querySelector('[name=notify]') || {}).checked }) }] });
      if (!go) return;
      const pw = genPassword();
      try { await SW.remote.setPassword(b.dataset.pw, pw, go.notify); } catch (e) { return U.toast(e.message, 'error'); }
      await db.audit('Password reset', { subject: b.dataset.pw });
      await U.modal({ title: 'New password for ' + b.dataset.pw, body: '<p class="pw-show">' + esc(pw) + '</p><p class="muted">' + (go.notify ? 'It is also being emailed to them. ' : 'Give this to the user. ') + 'It works straight away.</p>', actions: [{ label: 'Done', cls: 'btn-primary' }] });
    }));
    host.querySelectorAll('[data-em]').forEach((b) => (b.onclick = async () => {
      const em = await U.modal({ title: 'Email for ' + b.dataset.em, body: '<label class="fld"><span>Email address (leave empty to remove)</span><input name="e" type="email" maxlength="120" value="' + esc(b.dataset.cur) + '"></label><p class="muted">Used for "Forgot password?" codes and login notices.</p>',
        actions: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'btn-primary', onClick: async (m) => { const v = m.querySelector('[name=e]').value.trim(); if (v && !U.validEmail(v)) { U.toast('That email address does not look right.', 'error'); return false; } try { await SW.remote.setEmail(b.dataset.em, v); } catch (e) { U.toast(e.message, 'error'); return false; } return 'ok'; } }] });
      if (em) { U.toast('Email saved', 'ok'); renderLoginsRemote(host); }
    }));
    host.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = async () => {
      if (!(await U.confirm('Remove login?', 'Remove ' + b.dataset.rm + '? They will be signed out and cannot sign in again.', 'Remove', true))) return;
      try { await SW.remote.deleteLogin(b.dataset.rm); } catch (e) { return U.toast(e.message, 'error'); }
      await db.audit('Login removed', { subject: b.dataset.rm });
      renderLoginsRemote(host);
    }));
  }
  async function hashFor(pw) { const salt = U.token(16); return { salt, iterations: 150000, hash: await U.pbkdf2(pw, salt, 150000) }; }
  async function loginForm(host) {
    const pw0 = genPassword();
    const res = await U.modal({
      title: 'Add login',
      body: '<div class="form-grid"><label class="fld"><span>Role</span><select name="role"><option value="guard">Guard</option><option value="manager">Manager</option><option value="client">Client (read only)</option></select></label>' +
        '<label class="fld"><span>Guard (for guard logins)</span><select name="guardId">' + opt('', '—') + db.all('guards').map((g) => opt(g.id, g.name)).join('') + '</select></label>' +
        '<label class="fld"><span>Username</span><input name="username" maxlength="40" autocomplete="off" autocapitalize="none"></label>' +
        '<label class="fld"><span>Display name</span><input name="displayName" maxlength="60"></label>' +
        '<label class="fld span2"><span>Password (at least 10 characters)</span><input name="password" maxlength="100" value="' + esc(pw0) + '" autocomplete="off"></label></div>',
      actions: [{ label: 'Cancel', value: null }, { label: 'Add login', cls: 'btn-primary', onClick: async (m) => {
        const f = formData(m);
        const username = U.clean(f.username, 40).toLowerCase();
        if (!/^[a-z0-9._-]{3,40}$/.test(username)) return fieldErr(m, 'username', 'Use 3–40 letters, numbers, dots or dashes.');
        if (draftUsers().some((x) => x.username === username)) return fieldErr(m, 'username', 'That username already exists.');
        if (f.role === 'guard' && !f.guardId) return fieldErr(m, 'guardId', 'Choose which guard this login is for.');
        if ((f.password || '').length < 10) return fieldErr(m, 'password', 'Use at least 10 characters.');
        const g = f.guardId ? db.get('guards', f.guardId) : null;
        const u = Object.assign({ username, role: f.role, displayName: U.clean(f.displayName, 60) || (g ? g.name : username), guardId: f.role === 'guard' ? f.guardId : null, siteIds: f.role === 'client' ? db.all('sites').map((x) => x.id) : [] }, await hashFor(f.password));
        const l = draftUsers(); l.push(u); await saveDraft(l);
        return { u, pw: f.password };
      } }],
    });
    if (res) await U.modal({ title: 'Login added', body: '<p>Username: <b>' + esc(res.u.username) + '</b></p><p class="pw-show">' + esc(res.pw) + '</p><p class="muted">Note this password now. It starts working after you publish config.js.</p>', actions: [{ label: 'Done', cls: 'btn-primary' }] });
    renderLogins(host);
  }
  function publishConfig() {
    const strip = (r) => { const o = Object.assign({}, r); delete o.createdAt; delete o.updatedAt; delete o.source; return o; };
    const shiftKeys = ['id', 'guardId', 'siteId', 'date', 'start', 'end', 'startAt', 'endAt', 'patrolFreq', 'welfareFreq'];
    const st = db.settings();
    const C = {
      version: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      settings: { companyName: st.companyName, welfareInterval: st.welfareInterval, welfareGrace: st.welfareGrace, patrolFrequency: st.patrolFrequency, gpsRadius: st.gpsRadius, licenceWarnDays: st.licenceWarnDays },
      users: draftUsers(),
      sites: db.all('sites').map(strip),
      siteInstructions: db.all('siteInstructions').map(strip),
      guards: db.all('guards').map((g) => { const o = strip(g); delete o.siaCheckedAt; return o; }),
      patrolRoutes: db.all('patrolRoutes').map(strip),
      checkpoints: db.all('checkpoints').map(strip),
      shifts: db.all('shifts').map((x) => { const o = {}; shiftKeys.forEach((k) => (o[k] = x[k])); return o; }).sort((a, b) => (a.startAt > b.startAt ? 1 : -1)),
    };
    const js = '/* SecureWatch setup — generated ' + C.version + ' by ' + SW.session.displayName + '.\n * Upload this file to GitHub (replacing config.js) to update every device.\n * Passwords are stored as PBKDF2 hashes only. */\nwindow.SW_CONFIG = ' + JSON.stringify(C, null, 1) + ';\n';
    U.download('config.js', js, 'text/javascript');
    db.audit('Setup published', { subject: 'config ' + C.version });
    U.toast('config.js downloaded — upload it to GitHub to update all devices', 'ok', 6000);
  }

  /* ---- Audit ---- */
  VIEWS.audit = function (v) {
    const q = (M.filters.audit || '').toLowerCase();
    const rows = db.all('auditLogs').filter((a) => !q || (a.action + ' ' + a.user + ' ' + a.subject + ' ' + a.related).toLowerCase().includes(q)).sort((a, b) => (a.at < b.at ? 1 : -1));
    v.innerHTML = card('Audit log (' + rows.length + ')',
      '<div class="filters"><label class="fld fld-inline"><span>Search</span><input id="au-q" value="' + esc(M.filters.audit || '') + '" placeholder="Action, user or record"></label><span class="grow"></span><button class="btn btn-sm btn-secondary" id="au-csv">Export CSV</button></div>' +
      table([
        { label: 'Date / time', html: (a) => U.fmtDate(a.at) + ' ' + U.fmtTimeSec(a.at) },
        { label: 'User', html: (a) => esc(a.user) + '<small class="blk">' + esc(a.role) + '</small>' },
        { label: 'Action', html: (a) => '<b>' + esc(a.action) + '</b>' },
        { label: 'Detail', html: (a) => esc(a.subject) },
        { label: 'Site', html: (a) => (a.siteId ? esc(Q.siteName(a.siteId)) : '—') },
        { label: 'Related record', html: (a) => esc(a.related || '—') },
        { label: 'Data', html: src },
      ], rows.slice(0, 500), 'No audit records match.'));
    const inp = U.$('#au-q', v);
    inp.oninput = U.debounce(() => { M.filters.audit = inp.value; M.render(); setTimeout(() => { const i = U.$('#au-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 0); }, 350);
    U.$('#au-csv', v).onclick = () => SW.exports.audit(rows);
  };

  /* =========================================================
   * CLIENT PORTAL (read-only)
   * ========================================================= */
  SW.client = {
    site: null,
    mount(root) {
      root.innerHTML = '<div class="c-app"><header class="c-top"><div class="m-brand"><span class="logo-mark" aria-hidden="true"></span><div><strong>SecureWatch</strong><small>Client portal — read only</small></div></div><div class="m-top-r">' +
        (db.settings().demoMode ? '<span class="badge badge-demo">Demo</span>' : '') + '<button class="btn btn-sm btn-ghost-light" id="c-out">Sign out</button></div></header><main class="c-main" id="c-view"></main></div>';
      U.$('#c-out').onclick = () => SW.app.logout();
      SW.client.render(U.$('#c-view'), SW.session.siteIds, false);
    },
    render(host, siteIds, preview) {
      const sites = db.all('sites').filter((s) => !siteIds || !siteIds.length || siteIds.includes(s.id));
      if (!sites.length) { host.innerHTML = '<div class="empty"><p>No sites are linked to this client account.</p></div>'; return; }
      if (!sites.some((s) => s.id === SW.client.site)) SW.client.site = sites[0].id;
      const sid = SW.client.site;
      const scope = [sid];
      const st = M.status(scope);
      const recentPatrols = M.filterPatrols({}, scope).slice(0, 15);
      const missed = db.where('patrols', (p) => p.siteId === sid && p.status === 'Incomplete').sort((a, b) => (a.endAt < b.endAt ? 1 : -1)).slice(0, 10);
      const inc = db.where('incidents', (i) => i.siteId === sid).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 15);
      const wel = db.where('welfareChecks', (w) => w.siteId === sid).sort((a, b) => ((a.at || a.dueAt) < (b.at || b.dueAt) ? 1 : -1));
      const repDate = SW.client.date || M.defaultReportDate();
      const since = Date.now() - 7 * 86400000;
      const wk = wel.filter((w) => new Date(w.at || w.dueAt).getTime() > since);
      host.innerHTML =
        (sites.length > 1 ? '<div class="toolbar"><label class="fld fld-inline"><span>Site</span><select id="cl-site">' + sites.map((s) => opt(s.id, s.name, sid)).join('') + '</select></label></div>' : '') +
        '<h2 class="c-h">' + esc(Q.siteName(sid)) + '</h2>' +
        (preview ? '' : '<div class="note-box">Simulated client access for demonstration. This portal reads records stored in this browser and is not secure multi-user authentication.</div>') +
        alertsHtml(scope, false) + kpis(st) +
        '<div class="grid-2">' + card('Current guard status', liveStatusBlock(st)) +
        card('Welfare-check status (last 7 days)', '<div class="mini-stats"><div><b>' + wk.filter((w) => w.status === 'Confirmed').length + '</b><span>confirmed</span></div><div><b class="' + (wk.some((w) => w.status === 'Missed') ? 'red-text' : '') + '">' + wk.filter((w) => w.status === 'Missed').length + '</b><span>missed</span></div><div><b>' + (st.lastWel ? U.fmtTime(st.lastWel.at) : '—') + '</b><span>last confirmed</span></div></div>') + '</div>' +
        card('Patrol history', M.patrolTable(recentPatrols)) +
        card('Missed checkpoints', M.table([
          { label: 'Date', html: (p) => U.fmtShortDate(p.startAt) },
          { label: 'Patrol', html: (p) => esc(p.id) },
          { label: 'Missed', html: (p) => esc(p.missed.map((m) => m.name).join(', ')) },
          { label: 'Guard explanation', html: (p) => esc(p.explanation || '—') },
        ], missed, 'No missed checkpoints recorded.')) +
        card('Incidents', M.incidentTable(inc)) +
        card('Reports', '<div id="cl-rep"></div>');
      const ss = U.$('#cl-site', host); if (ss) ss.onchange = (e) => { SW.client.site = e.target.value; SW.client.render(host, siteIds, preview); };
      SW.reports.panel(U.$('#cl-rep', host), { siteIds: [sid] });
      M.bindInc(host, false);
      M.bindPatrolRows(host);
    },
  };

  /* =========================================================
   * REPORTS + EXPORTS
   * ========================================================= */
  SW.reports = {
    daily(siteId, ymd) {
      const site = Q.site(siteId);
      if (!site) return '<div class="empty"><p>Choose a site.</p></div>';
      const shifts = Q.shiftsOnDate(siteId, ymd).sort((a, b) => (a.startAt > b.startAt ? 1 : -1));
      const ids = new Set(shifts.map((s) => s.id));
      const patrols = db.where('patrols', (p) => ids.has(p.shiftId)).sort((a, b) => (a.startAt > b.startAt ? 1 : -1));
      const pids = new Set(patrols.map((p) => p.id));
      const scans = db.where('checkpointScans', (s) => pids.has(s.patrolId) && s.status === 'Valid');
      const invalid = db.where('checkpointScans', (s) => s.status === 'Invalid' && s.siteId === siteId && shifts.some((sh) => s.at >= sh.startAt && s.at <= (sh.actualEnd || sh.endAt)));
      const incidents = db.where('incidents', (i) => ids.has(i.shiftId)).sort((a, b) => (a.at > b.at ? 1 : -1));
      const wel = db.where('welfareChecks', (w) => ids.has(w.shiftId));
      const scheduled = shifts.reduce((n, s) => n + Q.scheduledPatrols(s), 0);
      const sev = (x) => incidents.filter((i) => i.severity === x).length;
      const missedCp = patrols.reduce((n, p) => n + (p.missed || []).filter((m) => m.required).length, 0);
      const s = db.settings();
      const row = (l, v) => '<tr><th>' + l + '</th><td>' + v + '</td></tr>';
      const demo = shifts.some((x) => x.source === 'demo');
      return '<article class="report">' +
        '<header class="rp-head"><div><p class="rp-brand">SECUREWATCH</p><h1>Daily security report</h1></div><div class="rp-co">' + esc(s.companyName) + '<br>Generated ' + U.fmtDateTime(new Date()) + '</div></header>' +
        (demo ? '<p class="rp-demo">Contains demonstration data</p>' : '') +
        '<table class="rp-kv">' + row('Site', esc(site.name)) + row('Client', esc(site.client || '—')) + row('Date', U.fmtLongDate(U.combine(ymd, '12:00'))) +
        row('Guard', shifts.length ? esc(Array.from(new Set(shifts.map((x) => Q.guardName(x.guardId)))).join(', ')) : '—') +
        row('Shift', shifts.length ? shifts.map((x) => esc(x.start) + ' – ' + esc(x.end) + (x.actualStart ? ' (on ' + U.fmtTime(x.actualStart) + ', off ' + (x.actualEnd ? U.fmtTime(x.actualEnd) : 'still on duty') + ')' : ' (not started)')).join('<br>') : 'No shift recorded') + '</table>' +
        (!shifts.length ? '<p class="rp-none">No shifts are recorded for this site on this date.</p>' : '') +
        '<div class="rp-sections">' +
        '<section><h2>Patrols</h2><table class="rp-kv">' + row('Scheduled', scheduled) + row('Completed', patrols.filter((p) => p.status === 'Complete').length) + row('Incomplete', patrols.filter((p) => p.status === 'Incomplete').length) + row('Not started', Math.max(0, scheduled - patrols.length)) + '</table></section>' +
        '<section><h2>Checkpoints</h2><table class="rp-kv">' + row('Verified', scans.length) + row('Missed', missedCp) + row('GPS out of range', scans.filter((x) => x.locationStatus === 'Out of range').length) + row('Invalid scans', invalid.length) + '</table></section>' +
        '<section><h2>Incidents</h2><table class="rp-kv">' + row('Total', incidents.length) + row('Critical', sev('Critical')) + row('High', sev('High')) + row('Medium', sev('Medium')) + row('Low', sev('Low')) + '</table></section>' +
        '<section><h2>Welfare checks</h2><table class="rp-kv">' + row('Completed', wel.filter((w) => w.status === 'Confirmed').length) + row('Missed', wel.filter((w) => w.status === 'Missed').length) + '</table></section>' +
        '</div>' +
        '<h2>Incident summary</h2>' + (incidents.length ? '<table class="rp-tbl"><thead><tr><th>Incident</th><th>Time</th><th>Type</th><th>Severity</th><th>Status</th><th>Summary</th></tr></thead><tbody>' + incidents.map((i) => '<tr><td>' + esc(i.id) + '</td><td>' + U.fmtTime(i.at) + '</td><td>' + esc(i.type) + '</td><td>' + esc(i.severity) + '</td><td>' + esc(i.status) + '</td><td>' + esc(i.description.slice(0, 160)) + (i.description.length > 160 ? '…' : '') + '</td></tr>').join('') + '</tbody></table>' : '<p>No incidents reported.</p>') +
        '<h2>Patrol log</h2>' + (patrols.length ? '<table class="rp-tbl"><thead><tr><th>Patrol</th><th>Route</th><th>Start</th><th>End</th><th>Checkpoints</th><th>Status</th></tr></thead><tbody>' + patrols.map((p) => '<tr><td>' + esc(p.id) + '</td><td>' + esc(Q.routeName(p.routeId)) + '</td><td>' + U.fmtTime(p.startAt) + '</td><td>' + (p.endAt ? U.fmtTime(p.endAt) : '—') + '</td><td>' + (p.endAt ? p.verified + '/' + p.total : 'In progress') + '</td><td>' + esc(p.status) + '</td></tr>' + (p.explanation ? '<tr class="rp-sub"><td></td><td colspan="5">Missed ' + esc(p.missed.map((m) => m.name).join(', ')) + ' — ' + esc(p.explanation) + '</td></tr>' : '')).join('') + '</tbody></table>' : '<p>No patrols recorded.</p>') +
        '<footer class="rp-foot">Generated by SecureWatch (by Syed Owais) from records stored on the device that produced this report. GPS positions come from the guard\u2019s phone and depend on its accuracy.</footer>' +
        '</article>';
    },
  };

  const cols = {
    patrols: [
      { label: 'Patrol ID', value: 'id' }, { label: 'Date', value: (p) => U.fmtDate(p.startAt) }, { label: 'Guard', value: (p) => Q.guardName(p.guardId) },
      { label: 'Site', value: (p) => Q.siteName(p.siteId) }, { label: 'Patrol', value: (p) => Q.routeName(p.routeId) }, { label: 'Start', value: (p) => U.fmtTime(p.startAt) },
      { label: 'End', value: (p) => (p.endAt ? U.fmtTime(p.endAt) : '') }, { label: 'Verified', value: (p) => (p.endAt ? p.verified : Q.patrolProgress(p).done) },
      { label: 'Total', value: (p) => (p.endAt ? p.total : Q.patrolProgress(p).total) }, { label: 'Completion %', value: (p) => { const d = p.endAt ? p.verified : Q.patrolProgress(p).done, t = p.endAt ? p.total : Q.patrolProgress(p).total; return Math.round((d / Math.max(1, t)) * 100); } },
      { label: 'Status', value: 'status' }, { label: 'Missed', value: (p) => (p.missed || []).map((m) => m.name).join('; ') }, { label: 'Explanation', value: 'explanation' },
      { label: 'Pauses', value: (p) => (p.pauses || []).length }, { label: 'Data source', value: (p) => p.source || 'device' },
    ],
    scans: [
      { label: 'Date', value: (s) => U.fmtDate(s.at) }, { label: 'Time', value: (s) => U.fmtTimeSec(s.at) }, { label: 'Guard', value: (s) => Q.guardName(s.guardId) },
      { label: 'Site', value: (s) => Q.siteName(s.siteId) }, { label: 'Patrol', value: 'patrolId' }, { label: 'Checkpoint ID', value: 'checkpointId' },
      { label: 'Checkpoint', value: (s) => (db.get('checkpoints', s.checkpointId) || {}).name || '' }, { label: 'Scan status', value: 'status' },
      { label: 'Latitude', value: (s) => (s.gps && s.gps.ok ? s.gps.lat : '') }, { label: 'Longitude', value: (s) => (s.gps && s.gps.ok ? s.gps.lng : '') },
      { label: 'GPS accuracy (m)', value: (s) => (s.gps && s.gps.ok ? s.gps.accuracy : '') }, { label: 'Distance (m)', value: 'distance' },
      { label: 'Location status', value: 'locationStatus' }, { label: 'Method', value: 'method' }, { label: 'Data source', value: (s) => s.source || 'device' },
    ],
    incidents: [
      { label: 'Incident ID', value: 'id' }, { label: 'Date', value: (i) => U.fmtDate(i.at) }, { label: 'Time', value: (i) => U.fmtTime(i.at) },
      { label: 'Guard', value: (i) => Q.guardName(i.guardId) }, { label: 'Site', value: (i) => Q.siteName(i.siteId) }, { label: 'Type', value: 'type' },
      { label: 'Severity', value: 'severity' }, { label: 'Description', value: 'description' }, { label: 'Location note', value: 'locationNote' },
      { label: 'Latitude', value: (i) => (i.gps && i.gps.ok ? i.gps.lat : '') }, { label: 'Longitude', value: (i) => (i.gps && i.gps.ok ? i.gps.lng : '') },
      { label: 'Witness', value: 'witness' }, { label: 'Police contacted', value: 'police' }, { label: 'Emergency services', value: 'emergency' },
      { label: 'Evidence files', value: (i) => (i.media || []).length }, { label: 'Status', value: 'status' }, { label: 'Data source', value: (i) => i.source || 'device' },
    ],
    attendance: [
      { label: 'Date', value: (a) => U.fmtDate(a.at) }, { label: 'Time', value: (a) => U.fmtTimeSec(a.at) }, { label: 'Event', value: 'type' },
      { label: 'Guard', value: (a) => Q.guardName(a.guardId) }, { label: 'Site', value: (a) => Q.siteName(a.siteId) }, { label: 'Shift', value: 'shiftId' },
      { label: 'GPS verified', value: (a) => (a.gps && a.gps.ok ? 'Yes' : 'No') }, { label: 'Latitude', value: (a) => (a.gps && a.gps.ok ? a.gps.lat : '') },
      { label: 'Longitude', value: (a) => (a.gps && a.gps.ok ? a.gps.lng : '') }, { label: 'Accuracy (m)', value: (a) => (a.gps && a.gps.ok ? a.gps.accuracy : '') },
      { label: 'Distance from site (m)', value: 'distance' }, { label: 'GPS error', value: (a) => (a.gps && !a.gps.ok ? a.gps.error : '') },
      { label: 'Device', value: (a) => (a.device ? a.device.os + ' / ' + a.device.browser : '') }, { label: 'Data source', value: (a) => a.source || 'device' },
    ],
    welfare: [
      { label: 'Date', value: (w) => U.fmtDate(w.at || w.dueAt) }, { label: 'Guard', value: (w) => Q.guardName(w.guardId) }, { label: 'Site', value: (w) => Q.siteName(w.siteId) },
      { label: 'Due', value: (w) => (w.dueAt ? U.fmtTime(w.dueAt) : 'Early') }, { label: 'Confirmed', value: (w) => (w.at ? U.fmtTime(w.at) : '') }, { label: 'Status', value: 'status' },
      { label: 'Latitude', value: (w) => (w.gps && w.gps.ok ? w.gps.lat : '') }, { label: 'Longitude', value: (w) => (w.gps && w.gps.ok ? w.gps.lng : '') }, { label: 'Data source', value: (w) => w.source || 'device' },
    ],
    audit: [
      { label: 'Date', value: (a) => U.fmtDate(a.at) }, { label: 'Time', value: (a) => U.fmtTimeSec(a.at) }, { label: 'User', value: 'user' }, { label: 'Role', value: 'role' },
      { label: 'Action', value: 'action' }, { label: 'Detail', value: 'subject' }, { label: 'Site', value: (a) => (a.siteId ? Q.siteName(a.siteId) : '') }, { label: 'Related record', value: 'related' },
    ],
  };
  const sorted = (store, key) => db.all(store).slice().sort((a, b) => ((a[key] || a.dueAt) < (b[key] || b.dueAt) ? 1 : -1));
  function exp(name, rows, c) {
    if (!rows.length) { U.toast('Nothing to export yet.', 'info'); return; }
    U.download('securewatch-' + name + '-' + U.today() + '.csv', U.csv(rows, c));
    db.audit('CSV exported', { subject: name + ' (' + rows.length + ' rows)' });
    U.toast('Exported ' + rows.length + ' rows', 'ok');
  }
  SW.exports = {
    patrols: (rows) => exp('patrol-history', rows || sorted('patrols', 'startAt'), cols.patrols),
    scans: (rows) => exp('checkpoint-scans', rows || sorted('checkpointScans', 'at'), cols.scans),
    incidents: (rows) => exp('incidents', rows || sorted('incidents', 'at'), cols.incidents),
    attendance: (rows) => exp('attendance', rows || sorted('attendance', 'at'), cols.attendance),
    welfare: (rows) => exp('welfare-checks', rows || sorted('welfareChecks', 'at'), cols.welfare),
    audit: (rows) => exp('audit-log', rows || sorted('auditLogs', 'at'), cols.audit),
  };
})();
