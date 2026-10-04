/* SecureWatch — Guard app (mobile-first) */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util, db = SW.db, Q = SW.q, OPS = SW.ops;
  const esc = U.esc;

  const G = (SW.guard = {
    tab: 'home',
    sub: null,
    gps: { state: 'idle', fix: null },
    timers: [],
    scanner: null,
    welfareShown: null,
    lastFinished: null,
    media: [],
    recorder: null,
  });

  const ICON = {
    patrol: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M8 8h3v3H8zM13 13h3v3h-3zM13 8h3M8 16h3"/></svg>',
    incident: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17v.5"/></svg>',
    welfare: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3V4z"/><path d="M5 17a3 3 0 013-3h10M9 8h5"/></svg>',
    end: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H6a1 1 0 00-1 1v14a1 1 0 001 1h4"/><path d="M14 8l4 4-4 4M18 12H9"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1v-8z"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
    sos: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M5.6 5.6l2.1 2.1M3 12h3M18.4 5.6l-2.1 2.1M21 12h-3"/><path d="M7 20v-5a5 5 0 0110 0v5H7z"/><path d="M5 20h14"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.6-6-11a6 6 0 0112 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
  };
  G.ICON = ICON;

  function shift() { return Q.shiftForGuard(SW.session.guardId); }
  function onDuty() { const s = shift(); return s && s.status === 'On duty' ? s : null; }

  /* ---------------- Shell ---------------- */
  G.mount = function (root) {
    root.innerHTML =
      '<div class="g-app">' +
      '<header class="g-top">' +
      '<div class="g-brand">' + (function () { const g = Q.guard(SW.session.guardId); return g && g.photo ? '<img class="avatar" src="' + g.photo + '" alt="" width="34" height="34">' : '<span class="logo-mark sm" aria-hidden="true"></span>'; })() + '<div><strong>' + esc((SW.session.displayName || 'SecureWatch').split(' ')[0]) + '</strong><small id="g-site">—</small></div></div>' +
      '<div class="g-chips"><button class="chip" id="g-gps" aria-label="GPS status — tap to refresh"></button><span class="chip" id="g-net"></span></div>' +
      '</header>' +
      (db.settings().demoMode ? '<div class="demo-strip">Training mode — simulated scans are allowed</div>' : '') +
      '<div id="g-alert"></div>' +
      '<main class="g-main" id="g-view" tabindex="-1"></main>' +
      '<nav class="g-nav" aria-label="Guard navigation">' +
      ['home', 'patrol', 'incident', 'more'].map((t) => '<button data-tab="' + t + '"' + (G.tab === t ? ' aria-current="page"' : '') + '>' + ICON[t === 'incident' ? 'incident' : t] + '<span>' + t.toUpperCase() + '</span></button>').join('') +
      '</nav></div>';
    root.querySelectorAll('.g-nav button').forEach((b) => (b.onclick = () => G.go(b.dataset.tab)));
    U.$('#g-gps').onclick = () => G.refreshGps(true);
    G.updateChips();
    G.render();
    G.startTimers();
    G.refreshGps(false);
  };

  G.unmount = function () {
    G.timers.forEach(clearInterval);
    G.timers = [];
    G.stopScanner();
    G.stopRecorder();
  };

  G.go = function (tab, sub) {
    G.tab = tab;
    G.sub = sub || null;
    U.$$('.g-nav button').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    G.render();
    const v = U.$('#g-view'); if (v) { v.scrollTop = 0; window.scrollTo(0, 0); }
  };

  G.render = function () {
    const v = U.$('#g-view');
    if (!v) return;
    const s = shift();
    U.$('#g-site').textContent = s ? Q.siteName(s.siteId) : 'No site assigned';
    const map = { home: renderHome, patrol: renderPatrol, incident: renderIncident, more: renderMore };
    v.innerHTML = '';
    map[G.tab](v, s);
    renderAlert();
  };

  G.updateChips = function () {
    const net = U.$('#g-net');
    if (net) { net.className = 'chip ' + (navigator.onLine ? 'chip-ok' : 'chip-bad'); net.innerHTML = '<i></i>' + (navigator.onLine ? 'Online' : 'Offline'); }
    const g = U.$('#g-gps');
    if (g) {
      const st = G.gps;
      let cls = 'chip', txt = 'GPS';
      if (st.state === 'locating') { cls += ' chip-wait'; txt = 'GPS…'; }
      else if (st.fix && st.fix.ok) { cls += st.fix.accuracy <= 50 ? ' chip-ok' : ' chip-warn'; txt = 'GPS ±' + st.fix.accuracy + ' m'; }
      else if (st.fix && !st.fix.ok) { cls += ' chip-bad'; txt = st.fix.code === 'denied' ? 'GPS blocked' : 'No GPS'; }
      g.className = cls; g.innerHTML = '<i></i>' + txt;
    }
  };

  G.refreshGps = async function (userAsked) {
    G.gps.state = 'locating'; G.updateChips();
    const fix = await U.getGPS({ timeout: 12000, maxAge: 30000 });
    G.gps = { state: 'done', fix };
    G.updateChips();
    if (userAsked) U.toast(fix.ok ? 'Location found (±' + fix.accuracy + ' m)' : fix.error, fix.ok ? 'ok' : 'error', 4500);
    return fix;
  };

  G.startTimers = function () {
    G.timers.forEach(clearInterval);
    G.timers = [];
    G.timers.push(setInterval(() => {
      if (document.hidden) return;
      const now = new Date();
      U.$$('[data-clock]').forEach((el) => (el.textContent = U.fmtTimeSec(now)));
      U.$$('[data-elapsed]').forEach((el) => { const p = db.get('patrols', el.dataset.elapsed); if (p) el.textContent = U.duration(Q.patrolElapsed(p)); });
    }, 1000));
    G.timers.push(setInterval(G.checkWelfare, 15000));
    setTimeout(G.checkWelfare, 1200);
  };

  /* ---------------- Welfare prompt ---------------- */
  G.checkWelfare = async function () {
    const s = onDuty();
    if (!s) return;
    const ev = await OPS.evaluateWelfare(s);
    if (ev.state === 'due') {
      const key = ev.dueAt.toISOString();
      if (G.welfareShown !== key && !U.$('.welfare-ov')) { G.welfareShown = key; showWelfarePrompt(s, ev); }
    }
    renderAlert();
  };

  function showWelfarePrompt(s, ev) {
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    const ov = overlay('welfare-ov',
      '<div class="ov-center">' +
      '<div class="ov-icon">' + ICON.welfare + '</div>' +
      '<h1>Welfare check required</h1>' +
      '<p class="ov-lead">Confirm that you are safe.</p>' +
      '<p class="ov-small">Due at ' + U.fmtTime(ev.dueAt) + '. If not confirmed by ' + U.fmtTime(ev.overdueAt) + ' it will be recorded as missed.</p>' +
      '<button class="g-btn g-btn-ok" id="wf-safe">I\u2019m safe</button>' +
      '<button class="g-link" id="wf-sos">I need help — SOS</button>' +
      '</div>');
    ov.querySelector('#wf-safe').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Recording…';
      const rec = await OPS.confirmWelfare(s);
      ov.remove();
      U.toast('Welfare check recorded at ' + U.fmtTime(rec.at) + (rec.gps.ok ? '' : ' (no GPS)'), 'ok');
      G.render();
    };
    ov.querySelector('#wf-sos').onclick = () => { ov.remove(); G.sos(); };
  }

  function renderAlert() {
    const host = U.$('#g-alert');
    if (!host) return;
    const s = onDuty();
    let html = '';
    if (s) {
      const sos = db.all('sosEvents').find((e) => e.shiftId === s.id && e.status === 'Active');
      if (sos) html += '<div class="g-banner g-banner-red">SOS active since ' + U.fmtTime(sos.at) + '</div>';
      const missed = db.where('welfareChecks', (w) => w.shiftId === s.id && w.status === 'Missed').length;
      if (missed) html += '<div class="g-banner g-banner-amber">' + missed + ' welfare check' + (missed > 1 ? 's' : '') + ' missed this shift</div>';
    }
    host.innerHTML = html;
  }

  /* ---------------- Overlays ---------------- */
  function overlay(cls, html) {
    const el = document.createElement('div');
    el.className = 'g-ov ' + cls;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = html;
    document.body.appendChild(el);
    const f = el.querySelector('button,textarea,input'); if (f) setTimeout(() => f.focus(), 30);
    return el;
  }
  G.overlay = overlay;

  /* ---------------- HOME ---------------- */
  function shiftCard(s) {
    const st = s.status === 'On duty' ? '<span class="badge badge-green">On duty</span>' : s.status === 'Scheduled' ? '<span class="badge badge-grey">Not started</span>' : U.badge(s.status);
    return '<section class="g-card g-shift">' +
      '<div class="g-shift-row"><div><small>Site</small><strong>' + esc(Q.siteName(s.siteId)) + '</strong></div>' + st + '</div>' +
      '<div class="g-shift-grid">' +
      '<div><small>Guard</small><b>' + esc(Q.guardName(s.guardId)) + '</b></div>' +
      '<div><small>Now</small><b data-clock>' + U.fmtTimeSec(new Date()) + '</b></div>' +
      '<div><small>Shift start</small><b>' + esc(s.start) + '</b><em>' + U.fmtDate(s.startAt) + '</em></div>' +
      '<div><small>Shift end</small><b>' + esc(s.end) + '</b><em>' + U.fmtDate(s.endAt) + '</em></div>' +
      '</div>' +
      (s.actualStart ? '<p class="g-meta">Started ' + U.fmtTime(s.actualStart) + ' — ' + gpsLine(db.get('attendance', s.clockInId)) + '</p>' : '') +
      '</section>';
  }
  function gpsLine(rec) {
    if (!rec || !rec.gps) return 'GPS not recorded';
    if (!rec.gps.ok) return 'GPS not verified';
    return 'GPS ±' + rec.gps.accuracy + ' m' + (rec.distance != null ? ', ' + rec.distance + ' m from site' : '');
  }

  function renderHome(v, s) {
    if (!s) {
      v.innerHTML = '<div class="g-empty">' + ICON.book + '<h2>No shift scheduled</h2><p>You are not on the rota for an upcoming shift. Ask your manager to add your shift, then reopen this screen.</p></div>';
      return;
    }
    let html = shiftCard(s);
    if (s.status === 'Scheduled') {
      const can = Q.canStart(s);
      html += can
        ? '<button class="g-btn g-btn-primary g-btn-xl" id="g-start">Start shift</button><p class="g-hint">Your location is checked when you start. Allow location access when your phone asks.</p>'
        : '<button class="g-btn g-btn-xl" disabled>Start shift</button><p class="g-hint">You can start this shift from ' + U.fmtTime(new Date(new Date(s.startAt).getTime() - 3600000)) + ' on ' + U.fmtDate(s.startAt) + '.</p>';
      html += '<div class="g-locked"><p>Patrols, checkpoint scans and incident reports unlock once the shift has started.</p></div>';
      html += '<button class="g-tile g-tile-row" data-act="instructions">' + ICON.book + '<span>View site instructions</span></button>';
      v.innerHTML = html;
      const b = U.$('#g-start', v);
      if (b) b.onclick = () => startShift(s, b);
      bindActs(v, s);
      return;
    }
    const p = Q.activePatrol(s.id);
    if (p) {
      const pr = Q.patrolProgress(p);
      html += '<button class="g-card g-patrol-strip" data-act="patrol"><div><small>' + (p.status === 'Paused' ? 'Patrol paused' : 'Patrol in progress') + '</small><strong>' + esc(Q.routeName(p.routeId)) + '</strong></div><div class="g-strip-num">' + pr.done + '<span>/' + pr.total + '</span></div></button>';
    }
    const ack = OPS.ackFor(s.guardId, s.siteId);
    html +=
      '<div class="g-grid">' +
      tile('patrol', ICON.patrol, p ? 'Continue patrol' : 'Start patrol', 'g-tile-blue') +
      tile('scan', ICON.scan, 'Scan checkpoint', 'g-tile-blue') +
      tile('incident', ICON.incident, 'Report incident') +
      tile('welfare', ICON.welfare, 'Welfare check') +
      tile('instructions', ICON.book, 'Site instructions' + (ack.current ? '' : '<em class="dot-new">Read</em>')) +
      tile('end', ICON.end, 'End shift') +
      '</div>' +
      '<button class="g-sos" data-act="sos">' + ICON.sos + '<span>SOS emergency</span></button>';
    v.innerHTML = html;
    bindActs(v, s);
  }
  function tile(act, icon, label, cls) { return '<button class="g-tile ' + (cls || '') + '" data-act="' + act + '">' + icon + '<span>' + label + '</span></button>'; }

  function bindActs(v, s) {
    v.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.act;
        if (a === 'patrol') G.go('patrol');
        else if (a === 'scan') G.openScanner();
        else if (a === 'incident') G.go('incident');
        else if (a === 'welfare') G.go('more', 'welfare');
        else if (a === 'instructions') G.go('more', 'instructions');
        else if (a === 'end') endShift(s);
        else if (a === 'sos') G.sos();
      };
    });
  }

  function gpsResultHtml(gps, distance, verb) {
    if (gps.ok && gps.accuracy <= 100) {
      return '<div class="gps-result ok">' + ICON.pin + '<div><strong>Location verified</strong><p>' + U.gpsLabel(gps) + (distance != null ? '<br>' + distance + ' m from the site location' : '') + '</p></div></div>';
    }
    if (gps.ok) {
      return '<div class="gps-result warn">' + ICON.pin + '<div><strong>Unable to obtain accurate location</strong><p>Accuracy was ±' + gps.accuracy + ' m. The ' + verb + ' was recorded with this lower-accuracy position.</p></div></div>';
    }
    return '<div class="gps-result bad">' + ICON.pin + '<div><strong>GPS verification could not be completed</strong><p>' + esc(gps.error) + ' The ' + verb + ' was recorded without a verified location.</p></div></div>';
  }

  async function startShift(s, btn) {
    btn.disabled = true; btn.textContent = 'Getting location…';
    const { gps, rec } = await OPS.startShift(s);
    G.gps = { state: 'done', fix: gps }; G.updateChips();
    await U.modal({ title: 'Shift started at ' + U.fmtTime(rec.at), body: gpsResultHtml(gps, rec.distance, 'clock-in') + (gps.code === 'denied' ? '<p class="muted">To enable location: open your browser settings, find this site, and allow Location.</p>' : ''), actions: [{ label: 'Continue', cls: 'btn-primary', value: true }] });
    G.render();
    G.checkWelfare();
    const ack = OPS.ackFor(s.guardId, s.siteId);
    if (!ack.current) U.toast('Please read and acknowledge the site instructions.', 'info', 5000);
  }

  async function endShift(s) {
    const p = Q.activePatrol(s.id);
    if (p) {
      const ok = await U.confirm('Patrol still in progress', 'End the current patrol before ending your shift. Go to the patrol now?', 'Go to patrol');
      if (ok) G.go('patrol');
      return;
    }
    const ok = await U.confirm('End shift?', 'Your location will be checked and the shift will be closed. You will not be able to record patrols after this.', 'End shift', true);
    if (!ok) return;
    U.toast('Getting location…', 'info', 2000);
    const { gps, rec } = await OPS.endShift(s);
    G.gps = { state: 'done', fix: gps }; G.updateChips();
    await U.modal({ title: 'Shift ended at ' + U.fmtTime(rec.at), body: gpsResultHtml(gps, rec.distance, 'clock-out') + '<p>Thank you. Your shift records are saved on this device.</p>', actions: [{ label: 'Done', cls: 'btn-primary', value: true }] });
    G.go('home');
  }

  /* ---------------- SOS ---------------- */
  G.sos = function () {
    const s = onDuty();
    if (!s) { U.toast('Start your shift to use SOS. In an emergency call 999 now.', 'error', 6000); return; }
    const ov = overlay('sos-ov',
      '<div class="ov-center">' +
      '<div class="ov-icon">' + ICON.sos + '</div>' +
      '<h1>Activate emergency alert?</h1>' +
      '<p class="ov-lead">Are you sure you want to activate emergency alert?</p>' +
      '<button class="g-btn g-btn-sos" id="sos-go">Activate SOS</button>' +
      '<button class="g-btn g-btn-ghost" id="sos-cancel">Cancel</button>' +
      '</div>');
    ov.querySelector('#sos-cancel').onclick = () => ov.remove();
    ov.querySelector('#sos-go').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Recording…';
      const rec = await OPS.activateSOS(s);
      if (navigator.vibrate) navigator.vibrate(500);
      const site = Q.site(s.siteId);
      ov.innerHTML = '<div class="ov-center">' +
        '<div class="ov-icon">' + ICON.sos + '</div>' +
        '<h1>SOS activated</h1>' +
        '<p class="ov-lead">Contact emergency services if required.</p>' +
        '<a class="g-btn g-btn-white" href="tel:999">Call 999</a>' +
        '<div class="ov-box"><p><b>Recorded:</b> ' + U.fmtDateTime(rec.at) + '<br><b>Location:</b> ' + esc(U.gpsLabel(rec.gps)) + '</p>' +
        (site && site.emergencyContacts ? '<p class="pre">' + esc(site.emergencyContacts) + '</p>' : '') +
        '<p class="ov-small">' + (SW.remote.enabled ? 'This alert is saved and sent to the management dashboard when the phone has signal. ' : 'This alert is saved on this phone and shows on the management dashboard opened on this device. ') + 'No text message or phone call is sent automatically — call for help yourself if needed.</p></div>' +
        '<button class="g-btn g-btn-ghost" id="sos-close">Close</button></div>';
      ov.querySelector('#sos-close').onclick = () => { ov.remove(); G.render(); };
    };
  };

  /* ---------------- PATROL ---------------- */
  function renderPatrol(v) {
    const s = onDuty();
    if (G.lastFinished) { renderFinished(v, db.get('patrols', G.lastFinished)); return; }
    if (!s) { v.innerHTML = lockedHtml('Start your shift to begin a patrol.'); bindLocked(v); return; }
    const p = Q.activePatrol(s.id);
    if (!p) {
      const routes = Q.routesForSite(s.siteId);
      const done = db.where('patrols', (x) => x.shiftId === s.id && x.endAt).length;
      let html = '<h1 class="g-h1">Start a patrol</h1><p class="g-sub">' + done + ' of ' + Q.scheduledPatrols(s) + ' scheduled patrols completed this shift.</p>';
      if (!routes.length) html += '<div class="g-empty"><h2>No patrol routes</h2><p>Your manager has not set up a patrol route for this site yet.</p></div>';
      routes.forEach((r) => {
        const cps = Q.checkpointsForRoute(r.id);
        html += '<section class="g-card g-route"><div><strong>' + esc(r.name) + '</strong><p>' + cps.length + ' checkpoints' + (r.description ? ' — ' + esc(r.description) : '') + '</p></div>' +
          '<button class="g-btn g-btn-primary" data-route="' + esc(r.id) + '"' + (cps.length ? '' : ' disabled') + '>Start patrol</button></section>';
      });
      v.innerHTML = html;
      v.querySelectorAll('[data-route]').forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        await OPS.startPatrol(s, b.dataset.route);
        U.toast('Patrol started', 'ok');
        G.render();
      }));
      return;
    }
    const pr = Q.patrolProgress(p);
    const paused = p.status === 'Paused';
    let list = '';
    pr.cps.forEach((c) => {
      const done = pr.scanned.has(c.id);
      const isNext = !done && pr.next && pr.next.id === c.id;
      const scan = done ? Q.scansForPatrol(p.id).find((x) => x.checkpointId === c.id) : null;
      list += '<li class="' + (done ? 'done' : isNext ? 'next' : '') + '"><span class="tick" aria-hidden="true">' + (done ? '✓' : '○') + '</span><div><b>' + esc(c.name) + '</b>' +
        (done ? '<small>' + U.fmtTime(scan.at) + ' — ' + esc(scan.locationStatus) + '</small>' : isNext ? '<small>Next checkpoint</small>' : c.required ? '' : '<small>Optional</small>') + '</div></li>';
    });
    v.innerHTML =
      '<section class="g-card g-progress">' +
      '<div class="g-progress-head"><div><small>' + (paused ? 'Paused' : 'Active patrol') + ' — ' + esc(p.id) + '</small><h1>' + esc(Q.routeName(p.routeId)) + '</h1></div>' +
      '<div class="g-elapsed"><small>Elapsed</small><b data-elapsed="' + esc(p.id) + '">' + U.duration(Q.patrolElapsed(p)) + '</b></div></div>' +
      '<div class="g-count"><b>' + pr.done + ' / ' + pr.total + '</b> checkpoints</div>' +
      '<div class="bar"><i style="width:' + Math.round((pr.done / Math.max(1, pr.total)) * 100) + '%"></i></div>' +
      '<ul class="g-cplist">' + list + '</ul></section>' +
      (paused
        ? '<button class="g-btn g-btn-primary g-btn-xl" id="p-resume">Resume patrol</button>'
        : '<button class="g-btn g-btn-primary g-btn-xl" id="p-scan">' + ICON.scan + ' Scan ' + (pr.next ? esc(pr.next.name) : 'checkpoint') + '</button>') +
      '<div class="g-row2">' +
      (paused ? '' : '<button class="g-btn g-btn-ghost" id="p-pause">Pause</button>') +
      '<button class="g-btn g-btn-ghost" id="p-end">End patrol</button></div>' +
      ((p.pauses || []).length ? '<p class="g-meta">Paused ' + p.pauses.length + ' time' + (p.pauses.length > 1 ? 's' : '') + ' on this patrol.</p>' : '');
    const sc = U.$('#p-scan', v); if (sc) sc.onclick = () => G.openScanner();
    const rs = U.$('#p-resume', v); if (rs) rs.onclick = async () => { await OPS.resumePatrol(p); G.render(); };
    const pa = U.$('#p-pause', v); if (pa) pa.onclick = () => pausePatrol(p);
    U.$('#p-end', v).onclick = () => endPatrol(p);
  }

  async function pausePatrol(p) {
    const reason = await U.modal({
      title: 'Pause patrol',
      body: '<label class="fld"><span>Reason</span><select id="pz-r"><option>Responding to incident</option><option>Attending visitor or contractor</option><option>Welfare break</option><option>Alarm response</option><option>Other</option></select></label>',
      actions: [{ label: 'Cancel', value: null }, { label: 'Pause patrol', cls: 'btn-primary', onClick: (m) => m.querySelector('#pz-r').value }],
    });
    if (!reason) return;
    await OPS.pausePatrol(p, reason);
    U.toast('Patrol paused — the pause is recorded', 'info');
    G.render();
  }

  async function endPatrol(p) {
    const pr = Q.patrolProgress(p);
    const missing = pr.cps.filter((c) => !pr.scanned.has(c.id));
    const missingReq = missing.filter((c) => c.required);
    if (!missingReq.length) {
      const ok = await U.confirm('End patrol?', missing.length ? 'Only optional checkpoints are left. The patrol will be marked complete.' : 'End this patrol now?', 'End patrol');
      if (!ok) return;
      await OPS.finishPatrol(p, '');
      G.lastFinished = p.id;
      G.render();
      return;
    }
    const ov = overlay('incomplete-ov',
      '<div class="ov-sheet">' +
      '<h1>Patrol incomplete</h1>' +
      '<p class="ov-lead">' + pr.done + ' / ' + pr.total + ' checkpoints verified</p>' +
      '<div class="ov-box"><b>Missing:</b><ul>' + missing.map((c) => '<li>' + esc(c.name) + (c.required ? '' : ' (optional)') + '</li>').join('') + '</ul></div>' +
      '<label class="fld fld-dark"><span>Explain why these were missed (required)</span><textarea id="inc-ex" rows="4" maxlength="1500" placeholder="For example: car park gate locked, attended alarm at loading bay"></textarea></label>' +
      '<button class="g-btn g-btn-amber" id="inc-save">Save and end patrol</button>' +
      '<button class="g-btn g-btn-ghost" id="inc-back">Continue patrol</button></div>');
    ov.querySelector('#inc-back').onclick = () => ov.remove();
    ov.querySelector('#inc-save').onclick = async () => {
      const t = U.clean(ov.querySelector('#inc-ex').value, 1500);
      if (t.length < 5) { U.toast('Add a short explanation before ending the patrol.', 'error'); ov.querySelector('#inc-ex').focus(); return; }
      await OPS.finishPatrol(p, t);
      ov.remove();
      G.lastFinished = p.id;
      G.go('patrol');
    };
  }

  function renderFinished(v, p) {
    if (!p) { G.lastFinished = null; renderPatrol(v); return; }
    const ok = p.status === 'Complete';
    v.innerHTML =
      '<section class="g-result ' + (ok ? 'ok' : 'warn') + '">' +
      '<div class="ov-icon">' + (ok ? ICON.patrol : ICON.incident) + '</div>' +
      '<h1>' + (ok ? 'Patrol complete' : 'Patrol incomplete') + '</h1>' +
      '<p class="big">' + p.verified + ' / ' + p.total + ' checkpoints verified</p>' +
      '<dl><dt>Patrol</dt><dd>' + esc(Q.routeName(p.routeId)) + '</dd><dt>Start time</dt><dd>' + U.fmtTime(p.startAt) + '</dd><dt>End time</dt><dd>' + U.fmtTime(p.endAt) + '</dd><dt>Duration</dt><dd>' + U.duration(Q.patrolElapsed(p)) + '</dd></dl>' +
      (!ok ? '<div class="ov-box"><b>Missing:</b> ' + esc(p.missed.map((m) => m.name).join(', ')) + '<br><b>Explanation:</b> ' + esc(p.explanation) + '</div>' : '') +
      '</section><button class="g-btn g-btn-primary g-btn-xl" id="pf-done">Done</button>';
    U.$('#pf-done', v).onclick = () => { G.lastFinished = null; G.go('home'); };
  }

  function lockedHtml(msg) {
    return '<div class="g-empty">' + ICON.patrol + '<h2>Shift not started</h2><p>' + esc(msg) + '</p><button class="g-btn g-btn-primary" data-go="home">Go to shift</button></div>';
  }
  function bindLocked(v) { const b = v.querySelector('[data-go]'); if (b) b.onclick = () => G.go('home'); }

  /* ---------------- QR SCANNER ---------------- */
  G.openScanner = function () {
    const s = onDuty();
    if (!s) { U.toast('Start your shift before scanning checkpoints.', 'error'); return; }
    const p = Q.activePatrol(s.id);
    const next = p ? Q.patrolProgress(p).next : null;
    const demoMode = db.settings().demoMode;
    const ov = overlay('scan-ov',
      '<div class="scan-top"><button class="icon-btn light" id="sc-x" aria-label="Close scanner">✕</button><strong>Scan checkpoint</strong><span></span></div>' +
      '<div class="scan-stage"><video id="sc-video" playsinline muted></video><div class="scan-frame" aria-hidden="true"></div><canvas id="sc-canvas" hidden></canvas>' +
      '<p class="scan-msg" id="sc-msg">Starting camera…</p></div>' +
      '<div class="scan-bottom">' +
      (next ? '<p class="scan-next">Next: <b>' + esc(next.name) + '</b></p>' : '') +
      '<button class="g-btn g-btn-ghost" id="sc-manual">Enter code manually</button>' +
      (demoMode ? '<button class="g-btn g-btn-demo" id="sc-sim">Demo: simulate scan' + (next ? ' of ' + esc(next.name) : '') + '</button>' : '') +
      '</div>');
    ov.querySelector('#sc-x').onclick = () => { G.stopScanner(); ov.remove(); };
    ov.querySelector('#sc-manual').onclick = async () => {
      G.stopScanner();
      const code = await U.modal({
        title: 'Enter checkpoint code',
        body: '<p class="muted">Type the checkpoint ID printed under the QR code (for example CP-003).</p><label class="fld"><span>Checkpoint ID</span><input id="mc" autocomplete="off" autocapitalize="characters" maxlength="60"></label>',
        actions: [{ label: 'Cancel', value: null }, { label: 'Check code', cls: 'btn-primary', onClick: (m) => { const v = m.querySelector('#mc').value.trim(); if (!v) return false; return v; } }],
      });
      if (code) { ov.remove(); handleScan(s, code, 'manual'); } else startCamera(ov);
    };
    const sim = ov.querySelector('#sc-sim');
    if (sim) sim.onclick = () => {
      let target = next;
      if (!target) { const r = Q.routesForSite(s.siteId)[0]; target = r ? Q.checkpointsForRoute(r.id)[0] : null; }
      if (!target) { U.toast('No checkpoints set up for this site.', 'error'); return; }
      G.stopScanner(); ov.remove(); handleScan(s, target.qr, 'simulated');
    };
    startCamera(ov);
  };

  async function startCamera(ov) {
    const msg = ov.querySelector('#sc-msg');
    const video = ov.querySelector('#sc-video');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg.textContent = 'Camera is not available in this browser. Enter the code manually.';
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      if (!document.body.contains(ov)) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      await video.play();
      msg.textContent = 'Point the camera at the checkpoint QR code';
      const detector = 'BarcodeDetector' in window ? await makeDetector() : null;
      const canvas = ov.querySelector('#sc-canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      G.scanner = { stream, timer: null, busy: false };
      const s = onDuty();
      const tick = async () => {
        if (!G.scanner || G.scanner.busy || video.readyState < 2) return;
        G.scanner.busy = true;
        try {
          let code = null;
          if (detector) {
            const r = await detector.detect(video);
            if (r && r[0]) code = r[0].rawValue;
          } else if (window.jsQR) {
            const w = Math.min(640, video.videoWidth), h = Math.round((video.videoHeight / video.videoWidth) * w);
            canvas.width = w; canvas.height = h;
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const r = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (r) code = r.data;
          }
          if (code) {
            if (navigator.vibrate) navigator.vibrate(80);
            G.stopScanner(); ov.remove(); handleScan(s, code, 'camera');
            return;
          }
        } catch (e) { /* keep scanning */ }
        if (G.scanner) G.scanner.busy = false;
      };
      G.scanner.timer = setInterval(tick, 220); // ~4–5 frames/sec is enough and saves battery
    } catch (e) {
      msg.textContent = e && e.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser settings, or enter the code manually.'
        : 'Could not start the camera (' + (e && e.name ? e.name : 'error') + '). Enter the code manually.';
    }
  }
  async function makeDetector() {
    try {
      const f = await window.BarcodeDetector.getSupportedFormats();
      if (f.includes('qr_code')) return new window.BarcodeDetector({ formats: ['qr_code'] });
    } catch (_) { /* fall back */ }
    return null;
  }
  G.stopScanner = function () {
    if (!G.scanner) return;
    clearInterval(G.scanner.timer);
    G.scanner.stream.getTracks().forEach((t) => t.stop());
    G.scanner = null;
  };

  async function handleScan(s, raw, method) {
    const wait = overlay('result-ov wait', '<div class="ov-center"><div class="spinner"></div><p class="ov-lead">Verifying checkpoint…</p></div>');
    const r = await OPS.scan(s, raw, method);
    wait.remove();
    if (r.ok) {
      const loc = r.scan.locationStatus;
      const ov = overlay('result-ov ok',
        '<div class="ov-center">' +
        '<div class="ov-icon">' + ICON.patrol + '</div>' +
        '<h1>Checkpoint verified</h1>' +
        '<dl class="res-dl"><dt>Checkpoint</dt><dd>' + esc(r.checkpoint.name) + '</dd><dt>Time</dt><dd>' + U.fmtTime(r.scan.at) + '</dd><dt>Location</dt><dd>' + esc(loc) + (r.scan.distance != null && loc !== 'Verified' ? ' (' + r.scan.distance + ' m away)' : '') + '</dd></dl>' +
        (method === 'simulated' ? '<p class="ov-small">Demo scan — simulated location, recorded as demo data.</p>' : '') +
        (r.completed ? '' : r.progress.next ? '<p class="ov-lead">Next: ' + esc(r.progress.next.name) + '</p>' : '') +
        '<button class="g-btn g-btn-white" id="rs-ok">' + (r.completed ? 'View summary' : 'Continue') + '</button></div>');
      const go = () => { clearTimeout(t); ov.remove(); if (r.completed) { G.lastFinished = r.patrol.id; } G.go('patrol'); };
      const t = setTimeout(go, r.completed ? 4000 : 3000);
      ov.querySelector('#rs-ok').onclick = go;
      return;
    }
    if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
    const title = r.kind === 'invalid' ? 'Invalid checkpoint' : r.kind === 'duplicate' ? 'Already scanned' : 'Wrong patrol route';
    const ov = overlay('result-ov ' + (r.kind === 'invalid' ? 'bad' : 'warn'),
      '<div class="ov-center"><div class="ov-icon">' + ICON.incident + '</div><h1>' + title + '</h1>' +
      '<p class="ov-lead">' + (r.kind === 'invalid' ? 'Please scan the correct checkpoint.' : esc(r.message)) + '</p>' +
      (r.kind === 'invalid' ? '<p class="ov-small">' + esc(r.message) + '</p>' : '') +
      '<button class="g-btn g-btn-white" id="rs-again">Scan again</button><button class="g-btn g-btn-ghost" id="rs-close">Back to patrol</button></div>');
    ov.querySelector('#rs-again').onclick = () => { ov.remove(); G.openScanner(); };
    ov.querySelector('#rs-close').onclick = () => { ov.remove(); G.go('patrol'); };
  }

  /* ---------------- INCIDENT ---------------- */
  const TYPES = ['Suspicious Activity', 'Intruder', 'Theft', 'Damage', 'Fire', 'Alarm', 'Accident', 'Medical', 'Safety Hazard', 'Maintenance Issue', 'Unauthorised Access', 'Other'];
  const SEV = ['Low', 'Medium', 'High', 'Critical'];
  G.TYPES = TYPES; G.SEV = SEV;

  function renderIncident(v) {
    const s = onDuty();
    if (G.sub && G.sub.indexOf('done:') === 0) { renderIncidentDone(v, db.get('incidents', G.sub.slice(5))); return; }
    if (!s) { v.innerHTML = lockedHtml('Start your shift to report an incident. In an emergency call 999.'); bindLocked(v); return; }
    G.media = [];
    let incGps = null;
    const site = Q.site(s.siteId) || {};
    const mediaOk = site.mediaAllowed !== false;
    v.innerHTML =
      '<h1 class="g-h1">Report incident</h1>' +
      '<p class="g-sub">Date, time and location are added automatically. <span id="inc-gps" class="muted">Getting location…</span></p>' +
      '<form id="inc-form" class="g-form" novalidate>' +
      '<fieldset><legend>Incident type</legend><div class="chips-pick">' + TYPES.map((t, i) => '<label><input type="radio" name="type" value="' + esc(t) + '"' + (i === 0 ? '' : '') + '><span>' + esc(t) + '</span></label>').join('') + '</div></fieldset>' +
      '<fieldset><legend>Severity</legend><div class="seg seg-sev">' + SEV.map((t) => '<label><input type="radio" name="severity" value="' + t + '"><span class="sev-' + t.toLowerCase() + '">' + t + '</span></label>').join('') + '</div></fieldset>' +
      '<label class="fld fld-dark"><span>What happened?</span><textarea name="description" rows="6" maxlength="5000" placeholder="Who, what, where, when. Include descriptions of people or vehicles."></textarea></label>' +
      '<label class="fld fld-dark"><span>Where on site (optional)</span><input name="locationNote" maxlength="200" placeholder="For example Loading Bay"></label>' +
      (mediaOk
        ? '<fieldset><legend>Evidence</legend><div class="media-btns">' +
          '<label class="g-btn g-btn-ghost file-btn">Add photo<input type="file" accept="image/*" capture="environment" multiple data-kind="photo" hidden></label>' +
          '<label class="g-btn g-btn-ghost file-btn">Add video<input type="file" accept="video/*" capture="environment" data-kind="video" hidden></label>' +
          '<button type="button" class="g-btn g-btn-ghost" id="rec-btn">Record voice note</button>' +
          '</div><div id="media-list" class="media-list"></div></fieldset>'
        : '<div class="g-locked"><p>Photos, video and audio recordings are not allowed on this site under the client contract. Describe what you saw in writing.</p></div>') +
      '<label class="fld fld-dark"><span>Witness name (optional)</span><input name="witness" maxlength="120" autocomplete="off"></label>' +
      '<fieldset><legend>Police contacted?</legend><div class="seg"><label><input type="radio" name="police" value="Yes"><span>Yes</span></label><label><input type="radio" name="police" value="No"><span>No</span></label></div></fieldset>' +
      '<fieldset><legend>Emergency services contacted?</legend><div class="seg"><label><input type="radio" name="emergency" value="Yes"><span>Yes</span></label><label><input type="radio" name="emergency" value="No"><span>No</span></label></div></fieldset>' +
      '<button type="submit" class="g-btn g-btn-primary g-btn-xl" id="inc-submit">Submit incident</button>' +
      '</form>';
    U.getGPS({ timeout: 12000 }).then((g) => {
      incGps = g;
      const el = U.$('#inc-gps');
      if (el) { el.textContent = g.ok ? 'Location captured (±' + g.accuracy + ' m).' : 'Location not available — the report will be saved without GPS.'; el.className = g.ok ? 'ok-text' : 'warn-text'; }
    });
    v.querySelectorAll('input[type=file]').forEach((inp) => (inp.onchange = () => {
      Array.from(inp.files).forEach((f) => {
        if (f.size > 60 * 1048576) { U.toast(f.name + ' is larger than 60 MB and was not added.', 'error', 5000); return; }
        G.media.push({ blob: f, kind: inp.dataset.kind, name: f.name || inp.dataset.kind });
      });
      inp.value = '';
      drawMedia();
    }));
    const rec = U.$('#rec-btn', v);
    if (rec) {
      if (!window.MediaRecorder || !navigator.mediaDevices) { rec.disabled = true; rec.textContent = 'Voice notes not supported'; }
      else rec.onclick = () => toggleRecord(rec);
    }
    U.$('#inc-form', v).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const val = (n) => { const x = f.querySelector('[name="' + n + '"]:checked'); return x ? x.value : ''; };
      const form = { type: val('type'), severity: val('severity'), description: f.description.value, locationNote: f.locationNote.value, witness: f.witness.value, police: val('police'), emergency: val('emergency') };
      const errs = [];
      if (!TYPES.includes(form.type)) errs.push('incident type');
      if (!SEV.includes(form.severity)) errs.push('severity');
      if (U.clean(form.description).length < 5) errs.push('description');
      if (!form.police) errs.push('police contacted');
      if (!form.emergency) errs.push('emergency services contacted');
      if (errs.length) { U.toast('Please complete: ' + errs.join(', '), 'error', 5000); return; }
      G.stopRecorder();
      const btn = U.$('#inc-submit'); btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const gps = incGps || (await U.getGPS({ timeout: 8000 }));
        const inc = await OPS.submitIncident(s, form, G.media, gps);
        G.media = [];
        G.go('incident', 'done:' + inc.id);
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Submit incident';
        U.toast('Could not save: ' + err.message, 'error', 6000);
      }
    };
  }

  function drawMedia() {
    const host = U.$('#media-list');
    if (!host) return;
    host.innerHTML = G.media.map((m, i) => '<div class="media-item"><span>' + esc(m.kind) + '</span><b>' + esc(m.name) + '</b><small>' + U.fileSize(m.blob.size) + '</small><button type="button" class="icon-btn" data-rm="' + i + '" aria-label="Remove">✕</button></div>').join('');
    host.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { G.media.splice(+b.dataset.rm, 1); drawMedia(); }));
  }

  async function toggleRecord(btn) {
    if (G.recorder) { G.stopRecorder(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      const chunks = [];
      const started = Date.now();
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        if (blob.size) { G.media.push({ blob, kind: 'audio', name: 'Voice note ' + U.fmtTime(new Date()) + ' (' + Math.round((Date.now() - started) / 1000) + 's)' }); drawMedia(); }
        btn.textContent = 'Record voice note'; btn.classList.remove('rec-on');
      };
      mr.start();
      G.recorder = mr;
      btn.textContent = 'Stop recording'; btn.classList.add('rec-on');
      setTimeout(() => { if (G.recorder === mr) G.stopRecorder(); }, 5 * 60000);
    } catch (e) {
      U.toast('Microphone not available: ' + (e.name === 'NotAllowedError' ? 'permission denied' : e.message), 'error', 5000);
    }
  }
  G.stopRecorder = function () { if (G.recorder) { try { G.recorder.stop(); } catch (_) { /* already stopped */ } G.recorder = null; } };

  function renderIncidentDone(v, inc) {
    if (!inc) { G.sub = null; renderIncident(v); return; }
    v.innerHTML = '<section class="g-result ok"><div class="ov-icon">' + ICON.incident + '</div><h1>Incident submitted</h1><p class="big">' + esc(inc.id) + '</p>' +
      '<dl><dt>Type</dt><dd>' + esc(inc.type) + '</dd><dt>Severity</dt><dd>' + esc(inc.severity) + '</dd><dt>Time</dt><dd>' + U.fmtDateTime(inc.at) + '</dd><dt>Location</dt><dd>' + esc(U.gpsLabel(inc.gps)) + '</dd><dt>Evidence</dt><dd>' + (inc.media || []).length + ' file(s)</dd></dl>' +
      '<p class="ov-small">' + (SW.remote.enabled ? (navigator.onLine ? 'Saved and sent to the server.' : 'Saved on this phone. It uploads automatically when you have signal.') : 'Saved on this device. Managers see it on the dashboard opened on this device or after a data transfer.') + '</p></section>' +
      '<button class="g-btn g-btn-primary g-btn-xl" id="id-home">Back to home</button><button class="g-btn g-btn-ghost" id="id-new">Report another</button>';
    U.$('#id-home', v).onclick = () => G.go('home');
    U.$('#id-new', v).onclick = () => G.go('incident');
  }

  /* ---------------- MORE ---------------- */
  function renderMore(v, s) {
    if (G.sub === 'instructions') return renderInstructions(v, s);
    if (G.sub === 'welfare') return renderWelfare(v);
    if (G.sub === 'log') return renderLog(v, s);
    if (G.sub === 'privacy') { v.innerHTML = '<button class="g-back" data-back>‹ More</button>' + SW.app.privacyHtml(); bindBack(v); return; }
    v.innerHTML =
      '<h1 class="g-h1">More</h1>' +
      '<div class="g-list">' +
      item('instructions', ICON.book, 'Site instructions') +
      item('welfare', ICON.welfare, 'Welfare check') +
      item('log', ICON.patrol, 'My shift activity') +
      (SW.remote.enabled ? item('syncnow', ICON.end, 'Sync now') : item('export', ICON.end, 'Send my data to a manager')) +
      (SW.remote.enabled ? item('password', ICON.patrol, 'Change password') : '') +
      item('privacy', ICON.book, 'Privacy notice') +
      item('logout', ICON.end, 'Sign out') +
      '</div>' +
      '<p class="g-meta">Signed in as ' + esc(SW.session.displayName) + '. ' + (SW.remote.enabled ? 'Waiting to upload: ' + db.pending().length + '.' : 'Storage: ' + (db.mode === 'indexeddb' ? 'IndexedDB on this device' : 'browser storage (limited)') + '.') + '</p>' +
      '<p class="credit">SecureWatch by Syed Owais</p>';
    v.querySelectorAll('[data-item]').forEach((b) => (b.onclick = async () => {
      const k = b.dataset.item;
      if (k === 'logout') { if (await U.confirm('Sign out?', onDuty() ? 'Your shift stays open. Sign back in to continue it.' : 'You will return to the sign-in screen.', 'Sign out')) SW.app.logout(); }
      else if (k === 'export') SW.app.exportBackup(true);
      else if (k === 'password') SW.app.changePassword();
      else if (k === 'syncnow') { if (!navigator.onLine) return U.toast('No signal. Your records are saved and will upload automatically.', 'info', 5000); await SW.app.syncNow(); U.toast(SW.remote.lastError ? 'Sync problem: ' + SW.remote.lastError : 'All data synced with the server', SW.remote.lastError ? 'error' : 'ok'); }
      else G.go('more', k);
    }));
  }
  function item(k, icon, label) { return '<button class="g-item" data-item="' + k + '">' + icon + '<span>' + label + '</span><i aria-hidden="true">›</i></button>'; }
  function bindBack(v) { const b = v.querySelector('[data-back]'); if (b) b.onclick = () => G.go('more'); }

  function renderInstructions(v, s) {
    if (!s) { v.innerHTML = '<button class="g-back" data-back>‹ More</button><div class="g-empty"><h2>No site</h2><p>You have no scheduled shift, so there are no site instructions to show.</p></div>'; bindBack(v); return; }
    const ins = Q.instructionsFor(s.siteId);
    const ack = OPS.ackFor(s.guardId, s.siteId);
    const lines = ins ? ins.text.split('\n').map((l) => l.trim()).filter(Boolean) : [];
    v.innerHTML = '<button class="g-back" data-back>‹ More</button>' +
      '<h1 class="g-h1">Site instructions</h1><p class="g-sub">' + esc(Q.siteName(s.siteId)) + (ins ? ' — version ' + ins.version + ', updated ' + U.fmtDate(ins.updatedAt) : '') + '</p>' +
      (lines.length ? '<ol class="g-ins">' + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ol>' : '<div class="g-empty"><p>No instructions have been added for this site.</p></div>') +
      (lines.length ? (ack.current
        ? '<div class="gps-result ok">' + ICON.patrol + '<div><strong>Acknowledged</strong><p>' + U.fmtDateTime(ack.last.at) + '</p></div></div>'
        : (s.status === 'On duty' || s.status === 'Scheduled' ? '<button class="g-btn g-btn-primary g-btn-xl" id="ack-btn">Acknowledge instructions</button>' : '')) : '');
    bindBack(v);
    const b = U.$('#ack-btn', v);
    if (b) b.onclick = async () => { b.disabled = true; await OPS.acknowledgeInstructions(s); U.toast('Instructions acknowledged', 'ok'); G.render(); };
  }

  async function renderWelfare(v) {
    const s = onDuty();
    if (!s) { v.innerHTML = '<button class="g-back" data-back>‹ More</button>' + lockedHtml('Welfare checks start when your shift starts.'); bindBack(v); bindLocked(v); return; }
    const ev = await OPS.evaluateWelfare(s);
    const last = db.where('welfareChecks', (w) => w.shiftId === s.id && w.status === 'Confirmed').sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    const interval = s.welfareFreq || db.settings().welfareInterval;
    v.innerHTML = '<button class="g-back" data-back>‹ More</button>' +
      '<h1 class="g-h1">Welfare check</h1><p class="g-sub">Every ' + interval + ' minutes this shift.</p>' +
      '<section class="g-card g-shift-grid two">' +
      '<div><small>Last confirmed</small><b>' + (last ? U.fmtTime(last.at) : '—') + '</b></div>' +
      '<div><small>' + (ev.state === 'due' ? 'Due now' : 'Next due') + '</small><b class="' + (ev.state === 'due' ? 'warn-text' : '') + '">' + (ev.state === 'due' ? U.fmtTime(ev.dueAt) : ev.nextAt ? U.fmtTime(ev.nextAt) : '—') + '</b></div></section>' +
      '<button class="g-btn g-btn-ok g-btn-xl" id="wf-now">I\u2019m safe</button><p class="g-hint">You can confirm early at any time. The next check is timed from your last confirmation.</p>';
    bindBack(v);
    U.$('#wf-now', v).onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Recording…';
      const rec = await OPS.confirmWelfare(s);
      U.toast('Welfare check recorded at ' + U.fmtTime(rec.at), 'ok');
      G.render();
    };
  }

  function renderLog(v, s) {
    const evs = [];
    if (s) {
      db.where('attendance', (a) => a.shiftId === s.id).forEach((a) => evs.push([a.at, a.type, a.gps && a.gps.ok ? 'GPS ±' + a.gps.accuracy + ' m' : 'No GPS']));
      db.where('checkpointScans', (x) => x.guardId === s.guardId && x.at >= (s.actualStart || s.startAt)).forEach((x) => evs.push([x.at, x.status === 'Valid' ? 'Checkpoint: ' + ((db.get('checkpoints', x.checkpointId) || {}).name || '') : 'Invalid scan', x.locationStatus]));
      db.where('welfareChecks', (w) => w.shiftId === s.id).forEach((w) => evs.push([w.at || w.dueAt, 'Welfare ' + w.status.toLowerCase(), '']));
      db.where('incidents', (i) => i.shiftId === s.id).forEach((i) => evs.push([i.at, i.id + ' ' + i.type, i.severity]));
      db.where('patrols', (p) => p.shiftId === s.id && p.endAt).forEach((p) => evs.push([p.endAt, 'Patrol ' + p.status.toLowerCase(), p.verified + '/' + p.total]));
    }
    evs.sort((a, b) => (a[0] < b[0] ? 1 : -1));
    v.innerHTML = '<button class="g-back" data-back>‹ More</button><h1 class="g-h1">My shift activity</h1>' +
      (evs.length ? '<ul class="g-log">' + evs.map((e) => '<li><time>' + U.fmtTime(e[0]) + '</time><div><b>' + esc(e[1]) + '</b><small>' + esc(e[2]) + '</small></div></li>').join('') + '</ul>' : '<div class="g-empty"><p>Nothing recorded yet this shift.</p></div>');
    bindBack(v);
  }
})();
