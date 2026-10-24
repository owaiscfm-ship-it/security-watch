/* SecureWatch — Facilities Manager app (mobile-first) */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util, db = SW.db, Q = SW.q;
  const esc = U.esc;
  const F = (SW.fm = { tab: 'today', timer: null });
  const T = () => SW.tasks;
  const PRI_C = { Low: '#8A97B4', Normal: '#2F6FE4', High: '#E0A100', Urgent: '#C8293A' };

  function mine() { return db.where('tasks', (t) => t.assigneeId === SW.session.guardId && t.status !== 'Cancelled'); }
  function groups() {
    const all = mine(), today = U.today();
    const open = all.filter((t) => T().isOpen(t));
    return {
      overdue: open.filter(T().isOverdue).sort((a, b) => (a.dueAt > b.dueAt ? 1 : -1)),
      today: open.filter((t) => !T().isOverdue(t) && t.dueAt && U.ymd(t.dueAt) === today).sort((a, b) => (a.dueAt > b.dueAt ? 1 : -1)),
      upcoming: open.filter((t) => !T().isOverdue(t) && (!t.dueAt || U.ymd(t.dueAt) > today)).sort((a, b) => (a.dueAt > b.dueAt ? 1 : -1)),
      done: all.filter((t) => t.status === 'Done').sort((a, b) => (a.completedAt < b.completedAt ? 1 : -1)).slice(0, 40),
    };
  }

  F.mount = function (root) {
    const me = db.get('fms', SW.session.guardId) || { name: SW.session.displayName };
    root.innerHTML =
      '<div class="f-app"><header class="f-top"><div class="f-me">' + SW.manager.avatar(me, 40) + '<div><strong>' + esc(me.name || SW.session.displayName) + '</strong><small>Facilities manager</small></div></div>' +
      '<div class="f-acts"><span class="chip ' + (navigator.onLine ? 'chip-ok' : 'chip-bad') + '" id="g-net"><i></i>' + (navigator.onLine ? 'Online' : 'Offline') + '</span><button class="icon-btn" id="f-menu" aria-label="Menu">☰</button></div></header>' +
      '<div class="f-tabs" role="tablist"></div><main class="f-main" id="f-view"></main><p class="credit">SecureWatch by Syed Owais</p></div>';
    U.$('#f-menu').onclick = menu;
    F.render();
    clearInterval(F.timer);
    F.timer = setInterval(() => { if (!document.hidden) { checkReminders(); if (!document.querySelector('.modal-wrap')) F.render(); } }, 60000);
    setTimeout(checkReminders, 1500);
  };
  F.unmount = function () { clearInterval(F.timer); };

  F.render = function () {
    const v = U.$('#f-view'); if (!v) return;
    const g = groups();
    const tabs = [['overdue', 'Overdue'], ['today', 'Today'], ['upcoming', 'Upcoming'], ['done', 'Done']];
    if (F.tab === 'today' && !g.today.length && g.overdue.length) F.tab = 'overdue';
    U.$('.f-tabs').innerHTML = tabs.map((t) => '<button role="tab" data-tab="' + t[0] + '"' + (F.tab === t[0] ? ' aria-selected="true"' : '') + ' class="' + (t[0] === 'overdue' && g.overdue.length ? 'has-bad' : '') + '">' + t[1] + '<b>' + g[t[0]].length + '</b></button>').join('');
    U.$$('.f-tabs button').forEach((b) => (b.onclick = () => { F.tab = b.dataset.tab; F.render(); }));
    const list = g[F.tab];
    const s = mine();
    const p = T().perf(SW.session.guardId, 30);
    v.innerHTML =
      (g.overdue.length && F.tab !== 'overdue' ? '<button class="f-banner" data-tab="overdue">⚠ ' + g.overdue.length + ' task' + (g.overdue.length > 1 ? 's are' : ' is') + ' overdue — tap to see</button>' : '') +
      (list.length ? list.map(cardHtml).join('') : '<div class="f-empty"><span>' + (F.tab === 'overdue' ? '✓' : '☕') + '</span><b>' + ({ overdue: 'Nothing overdue', today: 'Nothing due today', upcoming: 'No upcoming tasks', done: 'No completed tasks yet' }[F.tab]) + '</b></div>') +
      (s.length ? '<div class="f-stats"><div><b style="color:' + (p.score == null ? '#8A97B4' : p.score >= 90 ? '#188A52' : p.score >= 70 ? '#E0A100' : '#C8293A') + '">' + (p.score == null ? '—' : p.score + '%') + '</b><span>on time (30 days)</span></div><div><b>' + p.done + '</b><span>done (30 days)</span></div><div><b>' + p.open + '</b><span>open</span></div></div>' : '');
    v.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => openTask(db.get('tasks', b.dataset.t))));
    const bn = v.querySelector('.f-banner'); if (bn) bn.onclick = () => { F.tab = 'overdue'; F.render(); };
  };

  function cardHtml(t) {
    return '<button class="f-card" data-t="' + esc(t.id) + '" style="--pc:' + (PRI_C[t.priority] || '#2F6FE4') + '">' +
      '<span class="f-c-top">' + T().pri(t.priority) + ' ' + T().badge(t) + '</span>' +
      '<b class="f-c-title">' + esc(t.title) + '</b>' +
      '<span class="f-c-meta">' + (t.siteId ? esc(Q.siteName(t.siteId)) + ' · ' : '') + (t.status === 'Done' ? 'Done ' + U.fmtShortDate(t.completedAt) + ' ' + U.fmtTime(t.completedAt) : 'Due ' + U.fmtShortDate(t.dueAt) + ' ' + U.fmtTime(t.dueAt) + ' — ' + T().dueLabel(t)) + '</span></button>';
  }

  async function save(t, action, note) {
    T().history(t, action, note);
    await db.put('tasks', t);
    await db.audit('Task ' + action.toLowerCase(), { siteId: t.siteId, subject: t.title, related: t.id });
    if (SW.app.syncNow && navigator.onLine) SW.app.syncNow();
    else U.toast('Saved on this phone — it will upload when you have signal.', 'info', 5000);
    F.render();
  }

  async function openTask(t) {
    if (!t) return;
    const open = T().isOpen(t);
    const acts = [];
    if (t.status === 'Open') acts.push({ label: 'Start', value: 'start' });
    if (open) acts.push({ label: 'Can\u2019t do it', value: 'block' });
    acts.push({ label: 'Add note', value: 'note' });
    if (open) acts.push({ label: '✓ Mark done', cls: 'btn-primary', value: 'done' });
    else acts.push({ label: 'Close', cls: 'btn-primary', value: null });
    const r = await U.modal({ title: t.title, wide: true, body: T().detailHtml(t), actions: acts });
    if (!r) return;
    if (r === 'start') { t.status = 'In progress'; t.startedAt = new Date().toISOString(); await save(t, 'Started'); U.toast('Started', 'ok'); return; }
    if (r === 'done') {
      const n = await U.modal({ title: 'Mark done', body: '<label class="fld"><span>What did you do? (optional)</span><textarea name="n" rows="3" maxlength="1000"></textarea></label>' + (T().isOverdue(t) ? '<p class="amber-text">This task is overdue — it will be recorded as late.</p>' : ''),
        actions: [{ label: 'Cancel', value: null }, { label: 'Mark done', cls: 'btn-primary', onClick: (m) => ({ n: m.querySelector('[name=n]').value.trim() }) }] });
      if (!n) return;
      t.status = 'Done'; t.completedAt = new Date().toISOString(); if (!t.startedAt) t.startedAt = t.completedAt; t.completionNote = U.clean(n.n, 1000);
      await save(t, 'Completed', n.n); U.toast('Task done ✓', 'ok'); return;
    }
    if (r === 'block') {
      const n = await U.modal({ title: 'Can\u2019t complete this task', body: '<p>Your manager and the people on the notify list will be emailed.</p><label class="fld"><span>Reason *</span><textarea name="n" rows="3" maxlength="1000" placeholder="e.g. waiting for parts, no access to room"></textarea></label>',
        actions: [{ label: 'Cancel', value: null }, { label: 'Send', cls: 'btn-danger', onClick: (m) => { const x = m.querySelector('[name=n]').value.trim(); if (x.length < 3) { U.toast('Give a reason.', 'error'); return false; } return { n: x }; } }] });
      if (!n) return;
      t.status = 'Blocked'; t.blockedReason = U.clean(n.n, 1000);
      await save(t, 'Blocked', n.n); U.toast('Reported', 'ok'); return;
    }
    if (r === 'note') {
      const n = await U.modal({ title: 'Add note', body: '<label class="fld"><span>Note</span><textarea name="n" rows="3" maxlength="1000"></textarea></label>',
        actions: [{ label: 'Cancel', value: null }, { label: 'Add note', cls: 'btn-primary', onClick: (m) => { const x = m.querySelector('[name=n]').value.trim(); if (!x) return false; return { n: x }; } }] });
      if (!n) return;
      if (t.status === 'Blocked') t.status = 'In progress';
      await save(t, 'Note', n.n);
    }
  }

  /* reminders while the app is open (emails are sent by the server as well) */
  function checkReminders() {
    const KEY = 'sw_fm_seen';
    let seen = {};
    try { seen = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { seen = {}; }
    const fresh = [];
    mine().filter((t) => T().isOpen(t) && t.dueAt).forEach((t) => {
      const due = new Date(t.dueAt).getTime(), lead = (t.remindBefore || 60) * 60000, n = Date.now();
      if (n > due && !seen['o|' + t.id + '|' + U.today()]) { seen['o|' + t.id + '|' + U.today()] = 1; fresh.push({ t, title: 'Overdue: ' + t.title, urgent: true }); }
      else if (n <= due && n >= due - lead && !seen['r|' + t.id + '|' + t.dueAt]) { seen['r|' + t.id + '|' + t.dueAt] = 1; fresh.push({ t, title: 'Due ' + U.fmtTime(t.dueAt) + ': ' + t.title }); }
    });
    localStorage.setItem(KEY, JSON.stringify(seen));
    fresh.forEach((x) => {
      U.toast(x.title, x.urgent ? 'error' : 'info', 8000);
      if ('Notification' in window && Notification.permission === 'granted') { try { new Notification('SecureWatch', { body: x.title, icon: 'icon-192.png', tag: x.t.id }); } catch (_) { /* ignore */ } }
    });
    if (fresh.length && navigator.vibrate) navigator.vibrate([200, 100, 200]);
  }

  async function menu() {
    const pop = 'Notification' in window ? Notification.permission : 'unsupported';
    const r = await U.modal({ title: 'Menu', body: '<p class="muted">Signed in as ' + esc(SW.session.displayName) + '</p>',
      actions: [{ label: pop === 'granted' ? '🔔 Reminders on' : 'Turn on reminders', value: 'alerts' }, { label: 'Change password', value: 'pw' }, { label: 'Sync now', value: 'sync' }, { label: 'Sign out', cls: 'btn-danger', value: 'out' }] });
    if (r === 'alerts') SW.app.enableAlerts();
    if (r === 'pw') SW.app.changePassword();
    if (r === 'sync') { await SW.app.syncNow(); U.toast(SW.remote.lastError ? 'Sync problem: ' + SW.remote.lastError : 'Up to date', SW.remote.lastError ? 'error' : 'ok'); F.render(); }
    if (r === 'out') SW.app.logout();
  }
})();
