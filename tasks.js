/* SecureWatch — Facilities: tasks for Facilities Managers, delay notifications and performance */
(function () {
  'use strict';
  const SW = (window.SW = window.SW || {});
  const U = SW.util, db = SW.db, Q = SW.q, M = SW.manager;
  const esc = U.esc;
  const PRI = ['Low', 'Normal', 'High', 'Urgent'];
  const PRI_CLS = { Low: 'grey', Normal: 'blue', High: 'amber', Urgent: 'red' };
  const ST_CLS = { Open: 'grey', 'In progress': 'blue', Blocked: 'amber', Done: 'green', Cancelled: 'grey' };
  const REMIND = [[0, 'No reminder'], [60, '1 hour before'], [180, '3 hours before'], [1440, '1 day before'], [2880, '2 days before']];
  const REPEAT = [['none', 'Does not repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['monthly', 'Every month']];

  const T = (SW.tasks = {});
  const now = () => Date.now();
  T.isOpen = (t) => ['Open', 'In progress', 'Blocked'].includes(t.status);
  T.isOverdue = (t) => T.isOpen(t) && t.dueAt && new Date(t.dueAt).getTime() < now();
  T.dueLabel = function (t) {
    if (!t.dueAt) return '—';
    const ms = new Date(t.dueAt).getTime() - now();
    const abs = Math.abs(ms), h = Math.round(abs / 3600000), mins = Math.round(abs / 60000), d = Math.round(abs / 86400000);
    const span = abs < 3600000 ? mins + ' min' : abs < 86400000 * 2 ? h + ' h' : d + ' days';
    if (!T.isOpen(t)) return U.fmtShortDate(t.dueAt) + ' ' + U.fmtTime(t.dueAt);
    return ms < 0 ? '<b class="red-text">' + span + ' overdue</b>' : 'in ' + span;
  };
  T.badge = (t) => U.badge(T.isOverdue(t) ? 'Overdue' : t.status, T.isOverdue(t) ? 'red' : ST_CLS[t.status] || 'grey');
  T.pri = (p) => U.badge(p, PRI_CLS[p] || 'grey');
  T.onTime = (t) => t.status === 'Done' && t.completedAt && t.dueAt && new Date(t.completedAt) <= new Date(t.dueAt);
  T.history = (t, action, note) => { t.history = (t.history || []).concat([{ at: new Date().toISOString(), by: SW.session.displayName, action, note: note ? U.clean(note, 1000) : '' }]); };

  /* ---------- performance ---------- */
  T.perf = function (fmId, days) {
    const from = now() - (days || 30) * 86400000;
    const all = db.where('tasks', (t) => (!fmId || t.assigneeId === fmId) && t.status !== 'Cancelled');
    // counted: tasks finished in the period, plus tasks that fell due in the period (done or not)
    const inPeriod = all.filter((t) => (t.status === 'Done' && t.completedAt && new Date(t.completedAt).getTime() >= from) ||
      (t.dueAt && new Date(t.dueAt).getTime() >= from && new Date(t.dueAt).getTime() <= now()));
    const done = inPeriod.filter((t) => t.status === 'Done');
    const onTime = done.filter(T.onTime).length;
    const late = done.length - onTime;
    const overdueNow = all.filter(T.isOverdue).length;
    const missed = inPeriod.filter((t) => T.isOpen(t)).length;
    const durations = done.filter((t) => t.completedAt && t.createdAt).map((t) => (new Date(t.completedAt) - new Date(t.createdAt)) / 3600000);
    const avgH = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
    const score = inPeriod.length ? Math.round((onTime / inPeriod.length) * 100) : null;
    return { total: inPeriod.length, done: done.length, onTime, late, missed, overdueNow, open: all.filter(T.isOpen).length, avgH, score, blocked: all.filter((t) => t.status === 'Blocked').length };
  };
  const tone = (v) => (v == null ? '#D8E0EC' : v >= 90 ? '#188A52' : v >= 70 ? '#E0A100' : '#C8293A');

  /* ---------- Tasks page ---------- */
  M.VIEWS.tasks = function (v) {
    const f = (M.filters.tasks = M.filters.tasks || { view: 'open', fm: '', site: '', pri: '' });
    const all = db.all('tasks').slice();
    const match = (t) => (!f.fm || t.assigneeId === f.fm) && (!f.site || t.siteId === f.site) && (!f.pri || t.priority === f.pri);
    const views = {
      open: (t) => T.isOpen(t), overdue: T.isOverdue, today: (t) => T.isOpen(t) && t.dueAt && U.ymd(t.dueAt) === U.today(),
      blocked: (t) => t.status === 'Blocked', done: (t) => t.status === 'Done', all: () => true,
    };
    const rows = all.filter((t) => match(t) && views[f.view](t)).sort((a, b) => (f.view === 'done' ? (a.completedAt < b.completedAt ? 1 : -1) : (a.dueAt > b.dueAt ? 1 : -1)));
    const cnt = (k) => all.filter((t) => match(t) && views[k](t)).length;
    const fms = db.all('fms');
    const s = db.settings();
    v.innerHTML =
      '<div class="toolbar"><div class="seg seg-sm">' + [['open', 'Open'], ['overdue', 'Overdue'], ['today', 'Due today'], ['blocked', 'Blocked'], ['done', 'Done'], ['all', 'All']].map((x) =>
        '<label><input type="radio" name="tv" value="' + x[0] + '"' + (f.view === x[0] ? ' checked' : '') + '><span>' + x[1] + ' <em class="cnt' + (x[0] === 'overdue' && cnt('overdue') ? ' cnt-red' : '') + '">' + cnt(x[0]) + '</em></span></label>').join('') + '</div>' +
      '<label class="fld fld-inline"><span>Facilities manager</span><select id="tf-fm"><option value="">All</option>' + fms.map((x) => '<option value="' + esc(x.id) + '"' + (f.fm === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label>' +
      '<label class="fld fld-inline"><span>Priority</span><select id="tf-pri"><option value="">All</option>' + PRI.map((p) => '<option' + (f.pri === p ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label>' +
      '<span class="grow"></span><button class="btn btn-secondary" id="t-csv">Export CSV</button><button class="btn btn-primary" id="t-add"' + (fms.length ? '' : ' disabled title="Add a facilities manager first"') + '>+ New task</button></div>' +
      (fms.length ? '' : '<div class="alert alert-amber"><div>Add a facilities manager on the <a href="#/manager/fms">Facilities Team</a> page first, then create their tasks here.</div></div>') +
      M.card('Tasks', M.table([
        { label: 'Task', html: (t) => '<button class="link-btn link-dark t-open" data-t="' + esc(t.id) + '"><b>' + esc(t.title) + '</b></button><small class="blk">' + esc(t.id) + (t.repeat && t.repeat !== 'none' ? ' · repeats ' + esc(t.repeat) : '') + '</small>' },
        { label: 'Assigned to', html: (t) => '<span class="who">' + M.avatar(db.get('fms', t.assigneeId) || { name: Q.fmName(t.assigneeId) }, 28) + esc(Q.fmName(t.assigneeId)) + '</span>' },
        { label: 'Site', html: (t) => esc(t.siteId ? Q.siteName(t.siteId) : '—') },
        { label: 'Priority', html: (t) => T.pri(t.priority) },
        { label: 'Due', html: (t) => U.fmtShortDate(t.dueAt) + ' ' + U.fmtTime(t.dueAt) + '<small class="blk">' + T.dueLabel(t) + '</small>' },
        { label: 'Status', html: (t) => T.badge(t) + (t.status === 'Done' ? '<small class="blk">' + (T.onTime(t) ? 'on time' : '<span class="amber-text">late</span>') + '</small>' : '') },
        { label: '', html: (t) => '<button class="btn btn-sm btn-secondary t-open" data-t="' + esc(t.id) + '">Open</button>' },
      ], rows, f.view === 'overdue' ? 'Nothing overdue. 👍' : 'No tasks here.', { rowAttr: (t) => (T.isOverdue(t) ? 'class="row-bad"' : '') })) +
      M.card('Delay notifications', '<form id="tn-form" class="form-grid"><label class="fld span2"><span>Always email these people when any task becomes overdue (comma-separate)</span><input name="emails" maxlength="500" value="' + esc(s.taskNotifyEmails || '') + '" placeholder="you@crystalfm.co.uk, director@crystalfm.co.uk"></label>' +
        '<div class="span2"><button class="btn btn-primary">Save</button></div></form><p class="muted">Overdue emails go to the facilities manager, these people and anyone added on the task — then again every 24 hours until it is done. Reminders before the due time go to the facilities manager. Emails are sent by the Gmail script (Settings › Email notifications).</p>');
    v.querySelectorAll('[name=tv]').forEach((r) => (r.onchange = () => { f.view = r.value; M.render(); }));
    U.$('#tf-fm', v).onchange = (e) => { f.fm = e.target.value; M.render(); };
    U.$('#tf-pri', v).onchange = (e) => { f.pri = e.target.value; M.render(); };
    U.$('#t-add', v).onclick = () => T.form();
    U.$('#t-csv', v).onclick = () => T.csv(rows);
    v.querySelectorAll('.t-open').forEach((b) => (b.onclick = () => T.detail(db.get('tasks', b.dataset.t))));
    U.$('#tn-form', v).onsubmit = async (e) => {
      e.preventDefault();
      const val = e.target.emails.value;
      const bad = val.split(',').map((x) => x.trim()).filter(Boolean).filter((x) => !U.validEmail(x));
      if (bad.length) return U.toast('Check this email: ' + bad[0], 'error');
      await db.saveSettings({ taskNotifyEmails: val.split(',').map((x) => x.trim()).filter(Boolean).join(', ') });
      await db.audit('Task notification list changed');
      U.toast('Saved', 'ok');
    };
  };

  /* ---------- create / edit ---------- */
  T.form = async function (t, preset) {
    const isNew = !t;
    t = t || Object.assign({ priority: 'Normal', status: 'Open', remindBefore: 60, repeat: 'none', notifyEmails: '' }, preset || {});
    const sites = db.all('sites'), fms = db.all('fms').filter((x) => x.status !== 'Inactive' || x.id === t.assigneeId);
    const due = t.dueAt ? new Date(t.dueAt) : new Date(Date.now() + 86400000);
    const dDate = U.ymd(due), dTime = U.fmtTime(due) === '—' ? '17:00' : U.fmtTime(due);
    const res = await U.modal({
      title: isNew ? 'New task' : 'Edit ' + t.id, wide: true,
      body: '<div class="form-grid">' +
        '<label class="fld span2"><span>Task *</span><input name="title" maxlength="120" value="' + esc(t.title || '') + '" placeholder="e.g. Fix leaking tap in Oicon House kitchen"></label>' +
        '<label class="fld span2"><span>Details</span><textarea name="description" rows="3" maxlength="2000">' + esc(t.description || '') + '</textarea></label>' +
        '<label class="fld"><span>Assign to *</span><select name="assigneeId">' + fms.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === t.assigneeId ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label>' +
        '<label class="fld"><span>Site</span><select name="siteId"><option value="">—</option>' + sites.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === t.siteId ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></label>' +
        '<label class="fld"><span>Due date *</span><input type="date" name="dueDate" value="' + esc(dDate) + '"></label>' +
        '<label class="fld"><span>Due time (UK) *</span><input type="time" name="dueTime" value="' + esc(dTime) + '"></label>' +
        '<label class="fld"><span>Priority</span><select name="priority">' + PRI.map((p) => '<option' + (p === t.priority ? ' selected' : '') + '>' + p + '</option>').join('') + '</select></label>' +
        '<label class="fld"><span>Reminder to the facilities manager</span><select name="remindBefore">' + REMIND.map((r) => '<option value="' + r[0] + '"' + (+t.remindBefore === r[0] ? ' selected' : '') + '>' + r[1] + '</option>').join('') + '</select></label>' +
        '<label class="fld"><span>Repeat</span><select name="repeat">' + REPEAT.map((r) => '<option value="' + r[0] + '"' + (t.repeat === r[0] ? ' selected' : '') + '>' + r[1] + '</option>').join('') + '</select></label>' +
        '<label class="fld"><span>Also notify if delayed (emails, comma-separate)</span><input name="notifyEmails" maxlength="500" value="' + esc(t.notifyEmails || '') + '"></label>' +
        '</div><p class="muted">The facilities manager is emailed when the task is assigned' + (isNew ? '' : ' or reassigned') + '.</p>',
      actions: (isNew ? [] : [{ label: 'Cancel task', cls: 'btn-danger-ghost', value: 'cancel' }]).concat([{ label: 'Close', value: null }, { label: isNew ? 'Create task' : 'Save', cls: 'btn-primary', onClick: (m) => {
        const g = (n) => m.querySelector('[name=' + n + ']').value;
        if (U.clean(g('title')).length < 3) { U.toast('Describe the task.', 'error'); return false; }
        if (!g('assigneeId')) { U.toast('Choose who does it.', 'error'); return false; }
        if (!g('dueDate') || !g('dueTime')) { U.toast('Set the due date and time.', 'error'); return false; }
        const bad = g('notifyEmails').split(',').map((x) => x.trim()).filter(Boolean).filter((x) => !U.validEmail(x));
        if (bad.length) { U.toast('Check this email: ' + bad[0], 'error'); return false; }
        return { title: U.clean(g('title'), 120), description: U.clean(g('description'), 2000), assigneeId: g('assigneeId'), siteId: g('siteId'), dueAt: U.combine(g('dueDate'), g('dueTime')).toISOString(), priority: g('priority'), remindBefore: +g('remindBefore'), repeat: g('repeat'), notifyEmails: g('notifyEmails').split(',').map((x) => x.trim()).filter(Boolean).join(', ') };
      } }]),
    });
    if (!res) return;
    if (res === 'cancel') {
      if (!(await U.confirm('Cancel this task?', 'It will be closed and no more reminders will be sent.', 'Cancel task', true))) return;
      t.status = 'Cancelled'; T.history(t, 'Cancelled');
      await db.put('tasks', t); await db.audit('Task cancelled', { siteId: t.siteId, subject: t.title, related: t.id });
      U.toast('Task cancelled', 'ok'); M.render(); return;
    }
    const changedDue = !isNew && res.dueAt !== t.dueAt;
    Object.assign(t, res);
    if (changedDue) { delete t.remindedAt; delete t.overdueNotifiedAt; }
    if (isNew) {
      t.id = await SW.newId('tasks', 'TASK');
      t.createdAt = new Date().toISOString(); t.createdBy = SW.session.displayName;
      T.history(t, 'Created and assigned to ' + Q.fmName(t.assigneeId));
    } else T.history(t, 'Edited' + (changedDue ? ' — new due time ' + U.fmtDateTime(t.dueAt) : ''));
    await db.put('tasks', t);
    await db.audit(isNew ? 'Task created' : 'Task edited', { siteId: t.siteId, subject: t.title, related: t.id });
    U.toast(isNew ? 'Task created — ' + Q.fmName(t.assigneeId) + ' will be emailed' : 'Task saved', 'ok');
    if (SW.app.syncNow) SW.app.syncNow();
    M.render();
  };

  /* ---------- detail ---------- */
  T.detailHtml = function (t) {
    return '<div class="t-head">' + T.badge(t) + ' ' + T.pri(t.priority) + (t.repeat && t.repeat !== 'none' ? ' ' + U.badge('Repeats ' + t.repeat, 'blue') : '') + '</div>' +
      '<dl class="dl-grid"><dt>Assigned to</dt><dd>' + esc(Q.fmName(t.assigneeId)) + '</dd><dt>Site</dt><dd>' + esc(t.siteId ? Q.siteName(t.siteId) : '—') + '</dd>' +
      '<dt>Due</dt><dd>' + U.fmtDateTime(t.dueAt) + ' — ' + T.dueLabel(t) + '</dd>' +
      (t.startedAt ? '<dt>Started</dt><dd>' + U.fmtDateTime(t.startedAt) + '</dd>' : '') +
      (t.completedAt ? '<dt>Completed</dt><dd>' + U.fmtDateTime(t.completedAt) + ' ' + (T.onTime(t) ? U.badge('On time', 'green') : U.badge('Late', 'amber')) + '</dd>' : '') +
      (t.blockedReason && t.status === 'Blocked' ? '<dt>Blocked because</dt><dd>' + esc(t.blockedReason) + '</dd>' : '') +
      (t.overdueCount ? '<dt>Overdue emails sent</dt><dd>' + t.overdueCount + '</dd>' : '') +
      '<dt>Created</dt><dd>' + U.fmtDateTime(t.createdAt) + (t.createdBy ? ' by ' + esc(t.createdBy) : '') + '</dd></dl>' +
      (t.description ? '<p class="pre t-desc">' + esc(t.description) + '</p>' : '') +
      (t.completionNote ? '<p><b>Completion note:</b> ' + esc(t.completionNote) + '</p>' : '') +
      '<h3>History</h3><ul class="feed">' + (t.history || []).slice().reverse().map((h) => '<li><time>' + U.fmtDateTime(h.at) + '</time><div><b>' + esc(h.action) + '</b> — ' + esc(h.by) + (h.note ? '<small>' + esc(h.note) + '</small>' : '') + '</div></li>').join('') + '</ul>';
  };
  T.detail = async function (t) {
    if (!t) return;
    const open = T.isOpen(t);
    const r = await U.modal({
      title: t.title, wide: true,
      body: T.detailHtml(t) + '<label class="fld"><span>Add a note</span><input name="note" maxlength="1000" placeholder="Visible to the facilities manager"></label>',
      actions: [{ label: 'Edit', value: 'edit' }].concat(open ? [{ label: 'Mark done', value: 'done' }] : t.status === 'Done' || t.status === 'Cancelled' ? [{ label: 'Reopen', value: 'reopen' }] : [])
        .concat([{ label: 'Close', value: null }, { label: 'Add note', cls: 'btn-primary', onClick: (m) => { const n = m.querySelector('[name=note]').value.trim(); if (!n) { U.toast('Write a note first.', 'error'); return false; } return { note: n }; } }]),
    });
    if (r === 'edit') return T.form(t);
    if (r === 'done') { t.status = 'Done'; t.completedAt = new Date().toISOString(); T.history(t, 'Marked done by manager'); }
    else if (r === 'reopen') { t.status = 'Open'; delete t.completedAt; delete t.remindedAt; delete t.overdueNotifiedAt; T.history(t, 'Reopened'); }
    else if (r && r.note) T.history(t, 'Note', r.note);
    else return;
    await db.put('tasks', t); await db.audit('Task updated', { siteId: t.siteId, subject: t.title, related: t.id });
    if (SW.app.syncNow) SW.app.syncNow();
    M.render();
  };

  T.csv = function (rows) {
    if (!rows.length) return U.toast('Nothing to export.', 'info');
    U.download('securewatch-tasks-' + U.today() + '.csv', U.csv(rows, [
      { label: 'Task ID', value: 'id' }, { label: 'Task', value: 'title' }, { label: 'Assigned to', value: (t) => Q.fmName(t.assigneeId) },
      { label: 'Site', value: (t) => (t.siteId ? Q.siteName(t.siteId) : '') }, { label: 'Priority', value: 'priority' }, { label: 'Status', value: (t) => (T.isOverdue(t) ? 'Overdue' : t.status) },
      { label: 'Due', value: (t) => U.fmtDateTime(t.dueAt) }, { label: 'Started', value: (t) => (t.startedAt ? U.fmtDateTime(t.startedAt) : '') },
      { label: 'Completed', value: (t) => (t.completedAt ? U.fmtDateTime(t.completedAt) : '') }, { label: 'On time', value: (t) => (t.status === 'Done' ? (T.onTime(t) ? 'Yes' : 'No') : '') },
      { label: 'Overdue emails', value: (t) => t.overdueCount || 0 }, { label: 'Completion note', value: 'completionNote' }, { label: 'Repeats', value: 'repeat' },
    ]));
  };

  /* ---------- Facilities team + performance ---------- */
  M.VIEWS.fms = function (v) {
    const days = (M.filters.fmDays = M.filters.fmDays || 30);
    const fms = db.all('fms').slice().sort((a, b) => (a.name > b.name ? 1 : -1));
    const team = T.perf(null, days);
    v.innerHTML =
      '<div class="toolbar"><div class="seg seg-sm">' + [7, 30, 90].map((d) => '<label><input type="radio" name="fd" value="' + d + '"' + (days === d ? ' checked' : '') + '><span>' + d + ' days</span></label>').join('') + '</div><span class="grow"></span><button class="btn btn-primary" id="fm-add">+ Add facilities manager</button></div>' +
      '<div class="dtiles">' +
      tile('Tasks due', team.total, 'in the last ' + days + ' days', '#2F6FE4', 'all') +
      tile('Completed on time', team.score == null ? '—' : team.score + '%', team.onTime + ' of ' + team.total, tone(team.score), 'done') +
      tile('Overdue now', team.overdueNow, team.overdueNow ? 'need attention' : 'all on track', team.overdueNow ? '#C8293A' : '#188A52', 'overdue') +
      tile('Average time to complete', team.avgH == null ? '—' : fmtH(team.avgH), 'from assigned to done', '#0E2148', 'done') +
      '</div>' +
      M.card('Facilities managers', fms.length ? '<div class="staff">' + fms.map((x) => {
        const p = T.perf(x.id, days);
        return '<button class="staff-row fm-row" data-fm="' + esc(x.id) + '">' + '<span class="rank">' + (x.status === 'Active' ? '●' : '○') + '</span>' + M.avatar(x, 42) +
          '<span class="sr-name"><b>' + esc(x.name) + '</b><small>' + p.open + ' open · ' + p.done + ' done · ' + (p.overdueNow ? '<span class="red-text">' + p.overdueNow + ' overdue</span>' : '0 overdue') + '</small></span>' +
          metric('On time', p.score) + '<span class="sm"><small>Avg time</small><b>' + (p.avgH == null ? '—' : fmtH(p.avgH)) + '</b></span>' + '<span class="sm"><small>Late / missed</small><b>' + p.late + ' / ' + p.missed + '</b></span>' +
          '<span class="score" style="--sc:' + tone(p.score) + '"><b>' + (p.score == null ? '—' : p.score) + '</b><small>score</small></span></button>';
      }).join('') + '</div>' : '<div class="empty"><p>No facilities managers yet. Add one, then create a login for them in Settings › Logins (role: Facilities manager).</p></div>');
    v.querySelectorAll('[name=fd]').forEach((r) => (r.onchange = () => { M.filters.fmDays = +r.value; M.render(); }));
    U.$('#fm-add', v).onclick = () => fmForm();
    v.querySelectorAll('[data-fm]').forEach((b) => (b.onclick = () => fmProfile(b.dataset.fm)));
    v.querySelectorAll('[data-tgo]').forEach((b) => (b.onclick = () => { M.filters.tasks = { view: b.dataset.tgo, fm: '', site: '', pri: '' }; location.hash = '#/manager/tasks'; }));
  };
  function tile(l, val, sub, c, go) { return '<button class="dtile" data-tgo="' + go + '" style="--tc:' + c + '"><span class="dt-l">' + esc(l) + '</span><b class="dt-v">' + val + '</b><span class="dt-s">' + sub + '</span><span class="dt-go">›</span></button>'; }
  function metric(l, val) { return '<span class="sm"><small>' + l + '</small><span class="sm-bar"><i style="width:' + (val || 0) + '%;background:' + tone(val) + '"></i></span><b>' + (val == null ? '—' : val + '%') + '</b></span>'; }
  function fmtH(h) { return h < 1 ? Math.round(h * 60) + ' min' : h < 48 ? h.toFixed(1) + ' h' : (h / 24).toFixed(1) + ' days'; }

  async function fmForm(x) {
    const isNew = !x;
    x = x || { status: 'Active' };
    const res = await U.modal({
      title: isNew ? 'Add facilities manager' : 'Edit ' + x.name,
      body: '<div class="form-grid"><label class="fld span2"><span>Full name *</span><input name="name" maxlength="80" value="' + esc(x.name || '') + '"></label>' +
        '<label class="fld"><span>Email (task emails go here) *</span><input name="email" type="email" maxlength="120" value="' + esc(x.email || '') + '"></label>' +
        '<label class="fld"><span>Phone</span><input name="phone" maxlength="20" value="' + esc(x.phone || '') + '"></label>' +
        '<label class="fld"><span>Status</span><select name="status">' + ['Active', 'Inactive'].map((s) => '<option' + (s === x.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label></div>' +
        '<p class="muted">Then create their login: Settings › Logins › Add login › role "Facilities manager".</p>',
      actions: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'btn-primary', onClick: (m) => {
        const g = (n) => m.querySelector('[name=' + n + ']').value.trim();
        if (g('name').length < 2) { U.toast('Enter the name.', 'error'); return false; }
        if (!g('email') || !U.validEmail(g('email'))) { U.toast('Enter a valid email — task notifications go there.', 'error'); return false; }
        if (!U.validPhone(g('phone'))) { U.toast('Check the phone number.', 'error'); return false; }
        return { name: U.clean(g('name'), 80), email: g('email'), phone: g('phone'), status: g('status') };
      } }],
    });
    if (!res) return;
    Object.assign(x, res);
    if (isNew) x.id = SW.seq('fms', 'FM');
    await db.put('fms', x);
    await db.audit(isNew ? 'Facilities manager added' : 'Facilities manager updated', { subject: x.name, related: x.id });
    U.toast('Saved', 'ok'); M.render();
  }

  async function fmProfile(id) {
    const x = db.get('fms', id); if (!x) return;
    const p = T.perf(id, 30), p7 = T.perf(id, 7), p90 = T.perf(id, 90);
    const tasks = db.where('tasks', (t) => t.assigneeId === id).sort((a, b) => (a.dueAt < b.dueAt ? 1 : -1));
    // weekly on-time vs late for the last 8 weeks
    const weeks = [];
    for (let w = 7; w >= 0; w--) {
      const end = now() - w * 7 * 86400000, start = end - 7 * 86400000;
      const due = tasks.filter((t) => t.status !== 'Cancelled' && t.dueAt && new Date(t.dueAt).getTime() >= start && new Date(t.dueAt).getTime() < end);
      weeks.push({ lbl: new Date(start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), on: due.filter(T.onTime).length, late: due.filter((t) => t.status === 'Done' && !T.onTime(t)).length, miss: due.filter((t) => T.isOpen(t)).length });
    }
    const max = Math.max(1, ...weeks.map((w) => w.on + w.late + w.miss));
    const chart = '<svg class="chart-svg" viewBox="0 0 560 150">' + weeks.map((w, i) => {
      const x0 = 20 + i * 66, H = 110, k = H / max;
      let y = 120, out = '';
      [['on', '#188A52'], ['late', '#E0A100'], ['miss', '#C8293A']].forEach((s) => { const h = w[s[0]] * k; if (h) { y -= h; out += '<rect x="' + x0 + '" y="' + y + '" width="40" height="' + h + '" rx="3" fill="' + s[1] + '"><title>' + w.lbl + ': ' + w.on + ' on time, ' + w.late + ' late, ' + w.miss + ' not done</title></rect>'; } });
      return out + '<text x="' + (x0 + 20) + '" y="138" font-size="10" text-anchor="middle" fill="#4A5878">' + w.lbl + '</text>';
    }).join('') + '</svg><p class="rp-legend"><i style="background:#188A52"></i>on time <i style="background:#E0A100"></i>late <i style="background:#C8293A"></i>not done</p>';
    const r = await U.modal({
      title: x.name, wide: true,
      body: '<div class="gp-head">' + M.avatar(x, 80) + '<div><h3>' + esc(x.name) + '</h3><p>Facilities manager · ' + U.badge(x.status, x.status === 'Active' ? 'green' : 'grey') + '</p><p class="muted">' + esc(x.email || '') + (x.phone ? ' · ' + esc(x.phone) : '') + '</p></div>' +
        '<span class="score big" style="--sc:' + tone(p.score) + '"><b>' + (p.score == null ? '—' : p.score) + '</b><small>on time (30 d)</small></span></div>' +
        '<div class="gp-tiles"><div><small>Open tasks</small><b>' + p.open + '</b></div><div><small>Overdue now</small><b style="color:' + (p.overdueNow ? '#C8293A' : '#188A52') + '">' + p.overdueNow + '</b></div>' +
        '<div><small>Done (30 days)</small><b>' + p.done + '</b><em>' + p.onTime + ' on time · ' + p.late + ' late</em></div>' +
        '<div><small>On time — 7 / 30 / 90 days</small><b>' + [p7, p, p90].map((q) => (q.score == null ? '—' : q.score + '%')).join(' · ') + '</b></div>' +
        '<div><small>Average time to complete</small><b>' + (p.avgH == null ? '—' : fmtH(p.avgH)) + '</b></div><div><small>Blocked</small><b>' + p.blocked + '</b></div></div>' +
        '<h3>Last 8 weeks</h3>' + chart +
        '<h3>Tasks</h3>' + M.table([
          { label: 'Task', html: (t) => '<b>' + esc(t.title) + '</b><small class="blk">' + esc(t.id) + '</small>' },
          { label: 'Due', html: (t) => U.fmtShortDate(t.dueAt) + ' ' + U.fmtTime(t.dueAt) },
          { label: 'Status', html: (t) => T.badge(t) },
          { label: 'Completed', html: (t) => (t.completedAt ? U.fmtDateTime(t.completedAt) + ' ' + (T.onTime(t) ? '' : '<span class="amber-text">late</span>') : '—') },
        ], tasks.slice(0, 15), 'No tasks yet.'),
      actions: [{ label: 'Edit', value: 'edit' }, { label: 'New task for ' + x.name.split(' ')[0], value: 'task' }, { label: 'Close', cls: 'btn-primary', value: null }],
    });
    if (r === 'edit') fmForm(x);
    if (r === 'task') T.form(null, { assigneeId: id });
  }
  M.fmProfile = fmProfile;

  /* ---------- dashboard panel ---------- */
  T.dashPanel = function () {
    const all = db.all('tasks');
    if (!all.length && !db.all('fms').length) return '';
    const p = T.perf(null, 30);
    const overdue = all.filter(T.isOverdue).sort((a, b) => (a.dueAt > b.dueAt ? 1 : -1));
    const today = all.filter((t) => T.isOpen(t) && t.dueAt && U.ymd(t.dueAt) === U.today());
    return '<section class="panel"><div class="panel-head"><h2>Facilities tasks</h2><button class="btn btn-sm btn-secondary" data-go="tasks">All tasks</button></div>' +
      '<div class="ftiles">' +
      '<button data-go="tasks|view=open"><b>' + all.filter(T.isOpen).length + '</b><span>open</span></button>' +
      '<button data-go="tasks|view=overdue" class="' + (overdue.length ? 'bad' : '') + '"><b>' + overdue.length + '</b><span>overdue</span></button>' +
      '<button data-go="tasks|view=today"><b>' + today.length + '</b><span>due today</span></button>' +
      '<button data-go="fms"><b style="color:' + tone(p.score) + '">' + (p.score == null ? '—' : p.score + '%') + '</b><span>on time (30 d)</span></button></div>' +
      (overdue.length ? '<ul class="attn">' + overdue.slice(0, 5).map((t) => '<li><button data-go="task|' + esc(t.id) + '"><i style="background:#C8293A"></i><span><b>' + esc(t.title) + '</b><small>' + esc(Q.fmName(t.assigneeId)) + ' · ' + T.dueLabel(t).replace(/<[^>]+>/g, '') + '</small></span><em>›</em></button></li>').join('') + '</ul>' : '<p class="muted">No overdue tasks. 👍</p>') +
      '</section>';
  };
})();
