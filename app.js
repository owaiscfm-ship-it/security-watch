/* Crystal FM Operations Portal — Phase 2 */
const cfg = window.PORTAL_CONFIG;
const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
const S = { user: null, profile: null, perms: {}, settings: {}, sites: [], charts: [], dash: { year: String(new Date().getFullYear()), month: 'All', member: 'All' } };
const SECTIONS = [['home','Operations overview'],['ai','Crystal AI'],['recruitment','Recruitment (hiring)'],['covers','Covers'],['customer_care','Customer Care'],['training','Safeguarding'],['brighthr','BrightHR'],['contracts','Contracts and sites'],['operations','Operations map'],['finance','Finance and P&L'],['reports','Reports']];
const FLAGS = [['can_send_email','Send emails'],['can_bulk_send','Bulk send'],['can_import','Import'],['can_export','Export'],['can_delete','Delete'],['can_manage','Manage settings']];
const KINDS = [
  ['cover_new','New cover needed','covers'],['missed_cover','Missed covers (daily)','covers'],['email_failed','An email failed','covers'],
  ['client_email_due','Cover confirmed – tell the client','customer_care'],['client_email_overdue','Client emails overdue (daily)','customer_care'],
  ['vacancy_new','New vacancy raised','recruitment'],['vacancy_filled','Vacancy filled','recruitment'],['vacancy_old','Vacancies open 14+ days (daily)','recruitment'],
  ['training_passed','Safeguarding passed','training'],['training_failed','Safeguarding quiz failed','training'],['training_overdue','Safeguarding overdue (daily)','training'],['refresher_due','Refresher due (daily)','training'],
  ['sick_today','Someone off sick today (BrightHR)','brighthr'],['mention','Someone @mentions you','*'],['complaint_high','High-severity complaint','operations'],['audit_fail','Audit failed','operations'],['no_clockin','Cleaner not clocked in (Blip)','covers'],['year2_due','Year 2 pricing due (weekly)','contracts'],['user_added','New portal user','admin']];
const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const STATUSES = ['Vacant','In Progress','Offer','Filled','On Hold'];

/* ---------- helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssv = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmtN = (n) => Number(n || 0).toLocaleString('en-GB');
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), err ? 7000 : 3500);
}
async function fetchAll(table, select, build = (q) => q) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await build(sb.from(table).select(select)).range(from, from + 999);
    if (error) throw error;
    out = out.concat(data); if (data.length < 1000) return out; from += 1000;
  }
}
const isAdmin = () => S.profile?.role === 'super_admin';
const can = (sec, lvl = 'view') => isAdmin() || (lvl === 'view' ? ['view','edit'].includes(S.perms[sec]?.level) : S.perms[sec]?.level === 'edit');
const canFlag = (sec, flag) => isAdmin() || !!S.perms[sec]?.[flag];
async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch (_) {} throw new Error(msg); }
  return data;
}

/* ---------- errors: never leave a page stuck on "Loading" ---------- */
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message || String(e.reason);
  toast('Something went wrong: ' + msg, true);
  const m = $('#main'); if (m && /Loading/.test(m.textContent)) m.insertAdjacentHTML('beforeend', `<div class="card" style="border-color:var(--danger)"><h2>This page couldn't load</h2><p class="err" style="margin:6px 0 0">${esc(msg)}</p><p class="muted" style="margin:6px 0 0">Send this message to Syed.</p></div>`);
  console.error(e.reason);
});

/* ---------- theme ---------- */
const sysDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme(t) { S.themePref = t; document.documentElement.dataset.theme = t === 'system' ? (sysDark?.matches ? 'dark' : 'light') : t; try { localStorage.setItem('theme', t); } catch (_) {} }
sysDark?.addEventListener?.('change', () => { if (S.themePref === 'system') { applyTheme('system'); if (S.profile) route(); } });
try { applyTheme(localStorage.getItem('theme') || 'light'); } catch (_) { applyTheme('light'); }
const themeSwitch = () => '';
const themeBar = () => {
  const t = document.documentElement.dataset.theme;
  return `<div class="seg" role="group" aria-label="Theme">${[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']].map(([v, l]) => `<button data-theme="${v}" class="${(S.themePref || t) === v ? 'on' : ''}" aria-pressed="${(S.themePref || t) === v}" title="${v === 'system' ? 'Follow my device' : l}">${l}</button>`).join('')}</div>`;
};
document.addEventListener('click', (e) => { const b = e.target.closest('button[data-theme]'); if (b) { applyTheme(b.dataset.theme); if (S.profile) route(); } });

/* ---------- auth ---------- */
function renderLogin(msg = '') {
  $('#app').innerHTML = `<div class="loginpage"><section class="hero"><div style="display:flex;align-items:center;gap:12px"><div class="logo" aria-hidden="true"></div><div><b style="font-size:16px">Crystal Operations</b><div style="color:var(--bartext);font-size:12px">Crystal Facilities Management</div></div></div>
      <div><h1>One place for recruitment, covers, clients and contract performance.</h1><p>Live dashboards, automated emails and alerts for every team at Crystal FM.</p></div>
      <ul><li>Covers, vacancies and safeguarding in one view</li><li>Client emails and loss alerts sent in a click</li><li>BrightHR absences and contract P&amp;L, always current</li></ul></section>
    <section class="formside"><form class="login" id="loginForm"><div><h2>Sign in</h2><p class="muted" style="margin:4px 0 0">Use your Crystal FM work email.</p></div>
    <label class="f">Work email<input type="email" name="email" required autocomplete="username"></label>
    <label class="f">Password<input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn pri" type="submit">Sign in</button>
    <button class="btn" type="button" id="forgot">Forgot password?</button>
    <div class="err" id="loginMsg" role="alert">${esc(msg)}</div><p class="soft" style="font-size:12px;margin:0">Access is managed by Crystal FM Operations. Activity is logged.</p></form></section></div>`;
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault(); const f = new FormData(e.target);
    const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
    if (error) $('#loginMsg').textContent = 'Email or password is wrong. Try again or reset your password.'; else boot();
  };
  $('#forgot').onclick = async () => {
    const email = $('#loginForm [name=email]').value; if (!email) return ($('#loginMsg').textContent = 'Type your email first.');
    await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    $('#loginMsg').textContent = 'Check your inbox for a reset link.';
  };
}
function renderSetPassword(first = false) {
  $('#app').innerHTML = `<div class="center"><form class="login card" id="pwForm"><h2>${first ? 'Welcome! Choose your own password' : 'Set your password'}</h2>${first ? '<p class="muted" style="margin:0">You signed in with a temporary password. Pick a new one to continue.</p>' : ''}
    <label class="f">New password (min 10 characters)<input type="password" name="pw" minlength="10" required autocomplete="new-password"></label>
    <button class="btn pri">Save password</button><div class="err" id="pwMsg"></div></form></div>`;
  $('#pwForm').onsubmit = async (e) => {
    e.preventDefault(); const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get('pw') });
    if (error) $('#pwMsg').textContent = error.message; else { await sb.rpc('password_changed'); history.replaceState(null, '', location.pathname); boot(); }
  };
}
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return renderLogin();
  S.user = session.user;
  const { data: prof } = await sb.from('profiles').select('*').eq('id', S.user.id).single();
  if (!prof || !prof.active) { await sb.auth.signOut(); return renderLogin('Your account has no portal access. Ask Syed Owais to add you.'); }
  S.profile = prof;
  if (prof.must_change_password) return renderSetPassword(true);
  sb.rpc('seen');
  const { data: perms } = await sb.from('permissions').select('*').eq('user_id', S.user.id);
  S.perms = Object.fromEntries((perms || []).map((p) => [p.section, p]));
  const { data: st } = await sb.from('settings').select('*');
  S.settings = Object.fromEntries((st || []).map((x) => [x.key, x.value]));
  S.sites = await fetchAll('sites', 'id,name,address,contract_id');
  if (!location.hash) location.hash = '#/home';
  route();
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY' || location.hash.includes('type=invite')) renderSetPassword(); });
window.addEventListener('hashchange', () => S.profile && route());

/* ---------- shell ---------- */
const ICON = (d) => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>', chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>', hire: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M19 8v6M16 11h6"/>',
  cover: '<path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M9 16l2 2 4-4"/>', shield: '<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>', hr: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  money: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>', map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>', doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>' };
const NAV = [
  ['Overview'], ['#/home', 'Operations overview', 'home', 'home'],
  ['Recruitment'], ['#/dashboard', 'Recruitment dashboard', 'recruitment', 'chart'], ['#/hiring', 'New hiring', 'recruitment', 'hire'], ['#/pipeline', 'Hiring pipeline', 'recruitment', 'hire'], ['#/covers', 'Covers', 'covers', 'cover'], ['#/cover-board', 'Live cover board', 'covers', 'cover'], ['#/safeguarding', 'Safeguarding', 'training', 'shield'],
  ['Customer Care'], ['#/customer-care', 'Client cover emails', 'customer_care', 'mail'],
  ['People'], ['#/brighthr', 'BrightHR live', 'brighthr', 'hr'],
  ['Finance'], ['#/finance', 'Contract P&L', 'finance', 'money'],
  ['Operations'], ['#/map', 'Sites map', 'operations', 'map'], ['#/operations', 'Audits, complaints, orders', 'operations', 'shield'], ['#/contracts', 'Contracts and sites', 'contracts', 'doc'],
  ['Insights'], ['#/forecast', 'Forecasts and risk', 'home', 'chart'],
  ['Data'], ['#/data', 'Import and export', '*', 'doc'],
  ['Account'], ['#/settings', 'My settings', '*', 'gear'], ['#/admin', 'Admin', 'admin', 'lock']];
function shell(inner) {
  S.charts.forEach((c) => c.destroy()); S.charts = [];
  let html = '', pending = null;
  NAV.forEach((n) => {
    if (n.length === 1) { pending = n[0]; return; }
    const [h, l, sec, ic] = n; if (!(sec === '*' || can(sec))) return;
    if (pending) { html += `<div class="grp">${pending}</div>`; pending = null; }
    html += `<a href="${h}" class="${location.hash.startsWith(h) ? 'on' : ''}" title="${l}">${ICON(I[ic])}<span>${l}</span></a>`;
  });
  const ini = S.profile.full_name.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const t = document.documentElement.dataset.theme;
  $('#app').innerHTML = `<header class="appbar">
      <button class="iconbtn burger" id="burger" aria-label="Menu">${ICON('<path d="M3 6h18M3 12h18M3 18h18"/>')}</button>
      <a class="brand" href="#/home"><div class="logo" aria-hidden="true"></div><div><b>Crystal Operations</b><small>Crystal Facilities Management</small></div></a>
      <button class="search" id="cmdBtn" aria-label="Search the portal">${ICON('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}<span>Search pages, sites, contracts, staff…</span><kbd class="kbd">Ctrl K</kbd></button>
      <div class="spacer"></div>
      <div style="position:relative"><button class="newbtn" id="newBtn" aria-haspopup="true">${ICON('<path d="M12 5v14M5 12h14"/>')}New</button><div class="menu" id="newMenu" hidden></div></div>
      <div class="seg" role="group" aria-label="Theme"><button data-theme="light" class="${t === 'light' ? 'on' : ''}" aria-pressed="${t === 'light'}">Light</button><button data-theme="dark" class="${t === 'dark' ? 'on' : ''}" aria-pressed="${t === 'dark'}">Dark</button></div>
      <button class="iconbtn" id="bell" aria-label="Notifications">${ICON('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>')}<span class="badge" id="bellN" hidden></span></button>
      <div style="position:relative"><button class="avatar" id="meBtn" aria-label="Account menu">${esc(ini)}</button>
        <div class="menu" id="meMenu" hidden><div class="who"><b>${esc(S.profile.full_name)}</b><span>${esc(S.profile.email)} · ${esc(S.profile.role.replace('_', ' '))}</span></div><hr>
        <a href="#/settings">${ICON(I.gear)}My settings</a>${isAdmin() ? `<a href="#/admin">${ICON(I.lock)}Admin</a>` : ''}<hr><button id="signout">${ICON('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>')}Sign out</button></div></div>
    </header>
    <div class="frame"><nav class="side" aria-label="Main">${html}<div class="foot"><span>Crystal FM Operations Portal</span><br><button class="collapse" id="slim">${document.body.classList.contains('slim') ? '» Expand' : '« Collapse sidebar'}</button></div></nav>
    <div class="content"><main class="main" id="main">${inner}</main>
    <footer class="pagefoot"><span>© ${new Date().getFullYear()} Crystal Facilities Management Ltd · Internal use only</span><span>Signed in as ${esc(S.profile.full_name)} · ${new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span></footer></div></div>`;
  // breadcrumb
  const crumb = $('.head > div:first-child > .soft:first-child');
  if (crumb && !crumb.id) crumb.innerHTML = `<span>Crystal FM</span><span class="crumbsep">/</span><span>${esc(crumb.textContent)}</span>`;
  const NEW = [can('recruitment', 'edit') && ['New vacancy', '#/hiring', '#hAdd', I.hire], can('covers', 'edit') && ['New cover', '#/covers', '#cAdd', I.cover], can('finance', 'edit') && ['Import P&L', '#/finance', null, I.money], isAdmin() && ['Add a person', '#/admin', null, I.lock]].filter(Boolean);
  $('#newMenu').innerHTML = NEW.map(([l, h, btn, ic], i) => `<button data-new="${i}">${ICON(ic)}${l}</button>`).join('') || '<div class="who soft">Nothing to create with your access.</div>';
  $$('[data-new]').forEach((b) => (b.onclick = () => { const [, h, btn, ic] = NEW[+b.dataset.new]; $('#newMenu').hidden = true; if (h === '#/finance') S.fin = { ...(S.fin || {}), tab: 'import' }; if (h === '#/admin') S.adminTab = 'users'; location.hash === h ? route() : (location.hash = h); if (btn) { let n = 0; const t2 = setInterval(() => { const el = $(btn); if (el || ++n > 40) { clearInterval(t2); el && el.click(); } }, 150); } }));
  const toggle = (btn, menu) => { $(btn).onclick = (e) => { e.stopPropagation(); const m = $(menu); const open = m.hidden; $$('.menu').forEach((x) => (x.hidden = true)); m.hidden = !open; }; };
  toggle('#newBtn', '#newMenu'); toggle('#meBtn', '#meMenu');
  $('#signout').onclick = async () => { await sb.auth.signOut(); location.hash = ''; renderLogin(); };
  $('#bell').onclick = openBell; bellCount();
  $('#cmdBtn').onclick = openCmd;
  $('#burger').onclick = () => document.body.classList.toggle('navopen'); $$('.side a').forEach((a2) => a2.addEventListener('click', () => document.body.classList.remove('navopen')));
  S.drills = {}; mountAI();
  $('#slim').onclick = () => { document.body.classList.toggle('slim'); try { localStorage.setItem('slim', document.body.classList.contains('slim') ? '1' : ''); } catch (_) {} $('#slim').textContent = document.body.classList.contains('slim') ? '» Expand' : '« Collapse sidebar'; };
}
document.addEventListener('click', (e) => { if (!e.target.closest('.menu') && !e.target.closest('#newBtn') && !e.target.closest('#meBtn')) $$('.menu').forEach((m) => (m.hidden = true)); });
document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.profile) { e.preventDefault(); openCmd(); } if (e.key === 'Escape' && !$('#modal').hidden) $('#modal').hidden = true; });
try { if (localStorage.getItem('slim')) document.body.classList.add('slim'); } catch (_) {}
async function openCmd() {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<div class="cmdk" role="dialog" aria-modal="true" aria-label="Search"><input id="cq" placeholder="Search pages, sites, contracts, people…" autocomplete="off" aria-label="Search"><div class="res" id="cr"></div></div>`;
  m.onclick = (e) => { if (e.target === m) m.hidden = true; };
  const pages = NAV.filter((n) => n.length > 1 && (n[2] === '*' || can(n[2]))).map(([h, l, , ic]) => ({ t: l, h, ic: I[ic], k: 'Pages' }));
  if (!S.cmdK && can('contracts')) S.cmdK = (await sb.from('contracts').select('name').order('name')).data || [];
  if (!S.cmdP && can('brighthr')) S.cmdP = (await sb.from('brighthr_employees').select('name,payroll_number').eq('terminated', false).order('name').limit(3000)).data || [];
  const items = [...pages, ...(S.cmdK || []).map((k) => ({ t: k.name, h: '#/contracts', q: k.name, ic: I.doc, k: 'Contracts' })), ...S.sites.map((s) => ({ t: s.name, h: can('covers') ? '#/covers' : '#/contracts', q: s.name, ic: I.map, k: 'Sites' })), ...(S.settings.recruiters || []).map((r) => ({ t: r, h: '#/home', who: r, ic: I.hire, k: 'Team' })), ...(S.cmdP || []).map((p) => ({ t: p.name + (p.payroll_number ? ` · ${p.payroll_number}` : ''), h: '#/brighthr', staff: p.name, ic: I.hr, k: 'Staff' }))];
  let sel = 0, shown = [];
  const draw = () => {
    const q = $('#cq').value.toLowerCase().trim();
    shown = (q ? items.filter((x) => x.t.toLowerCase().includes(q)) : pages).slice(0, 40);
    let last = '';
    $('#cr').innerHTML = shown.map((x, i) => `${x.k !== last ? `<div class="h">${(last = x.k)}</div>` : ''}<a href="${x.h}" data-i="${i}" class="${i === sel ? 'sel' : ''}">${ICON(x.ic)}<span>${esc(x.t)}</span><small>${x.k === 'Pages' ? 'Go to page' : x.k === 'Team' ? 'Filter overview' : 'Open'}</small></a>`).join('') || '<p class="muted" style="padding:14px">No matches.</p>';
    $$('#cr a').forEach((a) => (a.onclick = (e) => { e.preventDefault(); go(shown[+a.dataset.i]); }));
  };
  const go = (x) => { if (!x) return; m.hidden = true; if (x.staff) S.bhr = { ...(S.bhr || {}), tab: 'people', q: x.staff, status: 'all' }; if (x.q && x.h === '#/contracts') S.kq = x.q; if (x.who) S.home = { ...(S.home || { month: new Date().toISOString().slice(0, 7) }), member: x.who }; location.hash === x.h ? route() : (location.hash = x.h); };
  $('#cq').oninput = () => { sel = 0; draw(); };
  $('#cq').onkeydown = (e) => { if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); } if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); } if (e.key === 'Enter') go(shown[sel]); };
  draw(); $('#cq').focus();
}
const spark = (vals, color = 'var(--c,var(--acc))') => { if (!vals || vals.length < 2) return ''; const mx = Math.max(...vals), mn = Math.min(...vals), w = 84, h = 30; const pts = vals.map((v, i) => `${(i / (vals.length - 1) * w).toFixed(1)},${(h - 3 - ((v - mn) / ((mx - mn) || 1)) * (h - 6)).toFixed(1)}`).join(' '); return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><polygon points="0,${h} ${pts} ${w},${h}" fill="${color}" opacity=".10"/></svg>`; };
const SKEL = `<div class="skel" aria-busy="true"><span class="sr">Loading…</span><div class="g"><i></i><i></i><i></i><i></i></div><i class="t"></i></div>`;
function route() {
  const h = location.hash;
  if (h.startsWith('#/comments/')) { const [, , type, id] = h.split('/'); location.hash = '#/home'; setTimeout(() => openComments(type, id, 'Comments'), 600); return; }
  if (h.startsWith('#/pipeline') && can('recruitment')) return pagePipeline();
  if (h.startsWith('#/cover-board') && can('covers')) return pageCoverBoard();
  if (h.startsWith('#/operations') && can('operations')) return pageOperations();
  if (h.startsWith('#/forecast')) return pageForecast();
  if (h.startsWith('#/home')) return pageHome();
  if (h.startsWith('#/hiring') && can('recruitment')) return pageHiring();
  if (h.startsWith('#/customer-care') && can('customer_care')) return pageCustomerCare();
  if (h.startsWith('#/safeguarding') && can('training')) return pageSafeguarding();
  if (h.startsWith('#/covers') && can('covers')) return pageCovers();
  if (h.startsWith('#/brighthr') && can('brighthr')) return pageBrightHR();
  if (h.startsWith('#/finance') && can('finance')) return pageFinance();
  if (h.startsWith('#/map') && can('operations')) return pageMap();
  if (h.startsWith('#/contracts') && can('contracts')) return pageContracts();
  if (h.startsWith('#/admin') && isAdmin()) return pageAdmin();
  if (h.startsWith('#/settings')) return pageSettings();
  if (h.startsWith('#/data')) return pageData();
  if (can('recruitment')) return pageDashboard();
  shell(`<h1>Welcome, ${esc(S.profile.full_name)}</h1><p class="muted">You don't have access to any sections yet. Ask Syed Owais to give you access.</p>`);
}

/* ---------- dashboard ---------- */
async function pageDashboard() {
  shell(`<div class="head"><div><div class="soft">Recruitment</div><h1 id="dTitle">Dashboard</h1></div><div class="row" id="dFilters"></div></div>${SKEL}`);
  const [hires, covers] = await Promise.all([
    fetchAll('hires', '*'),
    can('covers') ? fetchAll('covers', 'kind,date_from,date_to,recruiter,site,reason,absent_cleaner,cover_cleaner,client_email_status,cleaner_email_status') : Promise.resolve([]),
  ]);
  if (!$('#dFilters')) return; // user moved to another page while loading
  const members = [...new Set([...(S.settings.recruiters || []), ...hires.map((h) => h.recruiter), ...covers.map((c) => c.recruiter)].filter(Boolean))];
  const years = [...new Set([...hires.map((h) => h.raised_on), ...covers.map((c) => c.date_from)].filter(Boolean).map((d) => d.slice(0, 4)))].sort().reverse();
  const draw = () => {
    const F = S.dash, ok = (d) => d && (F.year === 'All' || d.startsWith(F.year)) && (F.month === 'All' || +d.slice(5, 7) === +F.month);
    const who = (r) => F.member === 'All' || (F.member === 'Unassigned' ? !r : r === F.member);
    const H = hires.filter((h) => ok(h.raised_on) && who(h.recruiter)), C = covers.filter((c) => ok(c.date_from) && who(c.recruiter));
    const planned = C.filter((c) => c.kind === 'Planned').length, unplanned = C.length - planned;
    const filled = H.filter((h) => h.status === 'Filled').length, fr = H.length ? Math.round(filled / H.length * 100) : 0;
    const sent = C.filter((c) => c.client_email_status === 'Sent').length, pend = C.filter((c) => c.client_email_status === 'Pending').length;
    $('#dTitle').textContent = `Recruitment dashboard · ${F.month === 'All' ? '' : MN[F.month - 1] + ' '}${F.year === 'All' ? 'All time' : F.year}${F.member === 'All' ? '' : ' · ' + F.member}`;
    const DK = { 'Covers deployed': ['Covers', C, COLS.cover], 'Planned covers': ['Planned covers', C.filter((c) => c.kind === 'Planned'), COLS.cover], 'Unplanned covers': ['Unplanned covers', C.filter((c) => c.kind === 'Unplanned'), COLS.cover], 'Roles raised': ['Roles raised', H, COLS.hire], 'Roles filled': ['Roles filled', H.filter((h) => h.status === 'Filled'), COLS.hire], 'Client emails pending': ['Client emails pending', C.filter((c) => c.client_email_status === 'Pending'), COLS.cover], 'Open roles': ['Open roles', H.filter((h) => h.status !== 'Filled'), COLS.hire], 'Avg days to fill': ['Filled roles with days to fill', H.filter((h) => h.status === 'Filled' && h.start_date), [...COLS.hire.slice(0, 6), ['fill', 'Days to fill', (r) => r.raised_on ? Math.round((new Date(r.start_date) - new Date(r.raised_on)) / 864e5) : '']]] };
    let di = 0;
    const k = (l, v, s, c) => { const d = DK[l]; return `<div class="card kpi${d ? ' click' : ''}" style="--c:var(${c})" ${d ? dset('rk' + (di++), d[0] + ' · ' + $('#dTitle').textContent.replace('Recruitment dashboard · ', ''), d[1], d[2]) : ''}><span>${l}</span><b>${v}</b><small>${s}</small></div>`; };
    $('#main').innerHTML = $('#main').firstElementChild.outerHTML + `
      <section class="grid">${k('Covers deployed', fmtN(C.length), 'planned + unplanned', '--acc')}${k('Planned covers', fmtN(planned), 'holiday, maternity', '--planned')}${k('Unplanned covers', fmtN(unplanned), 'sickness, same day', '--unplanned')}${k('Roles raised', fmtN(H.length), 'hiring requirements', '--raised')}${k('Roles filled', fmtN(filled), fr + '% fill rate', '--filled')}${k('Client emails pending', fmtN(pend), fmtN(sent) + ' sent', '--prog')}${(() => { const d = H.filter((h) => h.status === 'Filled' && h.raised_on && h.start_date && h.start_date >= h.raised_on).map((h) => (new Date(h.start_date) - new Date(h.raised_on)) / 864e5); return k('Avg days to fill', d.length ? Math.round(d.reduce((x, y) => x + y, 0) / d.length) : '—', 'raised to start date', '--offer'); })()}${k('Open roles', fmtN(H.length - filled), 'vacant, in progress, offer, on hold', '--unplanned')}</section>
      <section class="charts">
        <div class="card wide"><h2>Covers by month</h2><canvas id="cMonth" height="90"></canvas></div>
        <div class="card"><h2>Roles raised vs filled</h2><canvas id="cHire"></canvas></div>
        <div class="card"><h2>Hiring pipeline</h2><canvas id="cPipe"></canvas></div>
        <div class="card"><h2>Team leaderboard</h2><canvas id="cTeam"></canvas></div>
        <div class="card"><h2>Sites needing most covers</h2><canvas id="cSites"></canvas></div>
        <div class="card"><h2>Why covers were needed</h2><canvas id="cReason"></canvas></div>
        <div class="card"><h2>Planned vs unplanned</h2><canvas id="cSplit"></canvas></div>
      </section>`;
    filters(); charts(H, C);
  };
  const filters = () => {
    const F = S.dash, o = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
    $('#dFilters').innerHTML = `<label class="f">Year<select id="fY">${o('All', 'All', F.year)}${years.map((y) => o(y, y, F.year)).join('')}</select></label>
      <label class="f">Month<select id="fM">${o('All', 'All months', F.month)}${MN.map((m, i) => o(i + 1, m, F.month)).join('')}</select></label>
      <label class="f">Team member<select id="fP">${o('All', 'Whole team', F.member)}${members.map((m) => o(m, m, F.member)).join('')}${o('Unassigned', 'Unassigned', F.member)}</select></label>
      <button class="btn" id="fR">Reset</button>${reportBar('dR')}`;
    $('#dRX').onclick = () => downloadReport(`Crystal FM recruitment ${F.year}${F.month === 'All' ? '' : '-' + F.month}${F.member === 'All' ? '' : ' ' + F.member}`, [{ Filter: 'Year', Value: F.year }, { Filter: 'Month', Value: F.month }, { Filter: 'Team member', Value: F.member }]);
    $('#fY').onchange = (e) => { F.year = e.target.value; draw(); };
    $('#fM').onchange = (e) => { F.month = e.target.value; draw(); };
    $('#fP').onchange = (e) => { F.member = e.target.value; draw(); };
    $('#fR').onclick = () => { S.dash = { year: years[0] || 'All', month: 'All', member: 'All' }; draw(); };
  };
  const charts = (H, C) => {
    S.charts.forEach((c) => c.destroy()); S.charts = [];
    Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border'); Chart.defaults.font.family = "'Geist', sans-serif";
    const F = S.dash, who = (r) => F.member === 'All' || (F.member === 'Unassigned' ? !r : r === F.member);
    const yr = F.year === 'All' ? null : F.year;
    const keys = [...new Set(covers.filter((c) => c.date_from && (!yr || c.date_from.startsWith(yr))).map((c) => c.date_from.slice(0, 7)))].sort();
    const CM = covers.filter((c) => who(c.recruiter));
    const p = keys.map((k) => CM.filter((c) => c.date_from?.startsWith(k) && c.kind === 'Planned').length);
    const u = keys.map((k) => CM.filter((c) => c.date_from?.startsWith(k) && c.kind === 'Unplanned').length);
    let run = 0; const cum = keys.map((_, i) => (run += p[i] + u[i]));
    const lab = keys.map((k) => MN[+k.slice(5) - 1] + (yr ? '' : ' ' + k.slice(2, 4)));
    const mk = (id, cfgc) => S.charts.push(new Chart($(id), cfgc));
    mk('#cMonth', { data: { labels: lab, datasets: [
      { type: 'bar', label: 'Planned', data: p, backgroundColor: cssv('--planned'), stack: 's', borderRadius: 4 },
      { type: 'bar', label: 'Unplanned', data: u, backgroundColor: cssv('--unplanned'), stack: 's', borderRadius: 4 },
      { type: 'line', label: 'Running total', data: cum, borderColor: cssv('--text'), borderDash: [6, 5], pointRadius: 0, yAxisID: 'y2' }] },
      options: { onClick: (_, el) => { if (el.length) { const k = keys[el[0].index]; S.dash.year = k.slice(0, 4); S.dash.month = String(+k.slice(5)); setTimeout(draw); } },
        scales: { x: { stacked: true }, y: { stacked: true }, y2: { position: 'right', grid: { display: false } } } } });
    const hk = [...new Set(hires.filter((h) => h.raised_on && (!yr || h.raised_on.startsWith(yr))).map((h) => h.raised_on.slice(0, 7)))].sort();
    const HM = hires.filter((h) => who(h.recruiter));
    mk('#cHire', { type: 'bar', data: { labels: hk.map((k) => MN[+k.slice(5) - 1]), datasets: [
      { label: 'Raised', data: hk.map((k) => HM.filter((h) => h.raised_on?.startsWith(k)).length), backgroundColor: cssv('--raised'), borderRadius: 4 },
      { label: 'Filled', data: hk.map((k) => HM.filter((h) => h.raised_on?.startsWith(k) && h.status === 'Filled').length), backgroundColor: cssv('--filled'), borderRadius: 4 }] } });
    const sc = { Filled: '--filled', Offer: '--offer', 'In Progress': '--prog', Vacant: '--unplanned', 'On Hold': '--hold' };
    mk('#cPipe', { type: 'doughnut', data: { labels: STATUSES, datasets: [{ data: STATUSES.map((s) => H.filter((h) => h.status === s).length), backgroundColor: STATUSES.map((s) => cssv(sc[s])), borderWidth: 0 }] }, options: { cutout: '65%', onClick: (_, el) => { if (el.length) { const st2 = STATUSES[el[0].index]; dset('rp', `Roles: ${st2}`, H.filter((h) => h.status === st2), COLS.hire); drill('rp'); } } } });
    const all = {}; const both = (r) => r || 'Unassigned';
    covers.filter((c) => (F.year === 'All' || c.date_from?.startsWith(F.year)) && (F.month === 'All' || +c.date_from?.slice(5, 7) === +F.month)).forEach((c) => { all[both(c.recruiter)] = (all[both(c.recruiter)] || 0) + 1; });
    const tm = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 10);
    mk('#cTeam', { type: 'bar', data: { labels: tm.map((x) => x[0]), datasets: [{ label: 'Covers', data: tm.map((x) => x[1]), backgroundColor: tm.map((x) => x[0] === F.member ? cssv('--prog') : cssv('--acc')), borderRadius: 6 }] },
      options: { indexAxis: 'y', plugins: { legend: { display: false } }, onClick: (_, el) => { if (el.length) { const n = tm[el[0].index][0]; S.dash.member = S.dash.member === n ? 'All' : n; setTimeout(draw); } } } });
    const sites = {}; C.forEach((c) => { if (c.site) sites[c.site] = (sites[c.site] || 0) + 1; });
    const ts = Object.entries(sites).sort((a, b) => b[1] - a[1]).slice(0, 10);
    mk('#cSites', { type: 'bar', data: { labels: ts.map((x) => x[0].length > 28 ? x[0].slice(0, 27) + '…' : x[0]), datasets: [{ data: ts.map((x) => x[1]), backgroundColor: cssv('--unplanned'), borderRadius: 6 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, onClick: (_, el) => { if (el.length) { const n = ts[el[0].index][0]; dset('rs', `Covers at ${n}`, C.filter((c) => c.site === n), COLS.cover); drill('rs'); } } } });
    const rs = { 'Holiday / leave': 0, Sickness: 0, Maternity: 0, 'Term break': 0, Other: 0, 'Not recorded': 0 };
    C.forEach((c) => { const r = (c.reason || '').toLowerCase(); rs[!r ? 'Not recorded' : /sick|ill|hospital/.test(r) ? 'Sickness' : /mat/.test(r) ? 'Maternity' : /holiday|annual|leave/.test(r) ? 'Holiday / leave' : /term|break/.test(r) ? 'Term break' : 'Other']++; });
    mk('#cReason', { type: 'doughnut', data: { labels: Object.keys(rs), datasets: [{ data: Object.values(rs), backgroundColor: ['--planned','--unplanned','--raised','--prog','--hold','--soft'].map(cssv), borderWidth: 0 }] }, options: { cutout: '60%' } });
    mk('#cSplit', { type: 'pie', data: { labels: ['Planned', 'Unplanned'], datasets: [{ data: [C.filter((c) => c.kind === 'Planned').length, C.filter((c) => c.kind === 'Unplanned').length], backgroundColor: [cssv('--planned'), cssv('--unplanned')], borderWidth: 0 }] } });
  };
  if (!years.includes(S.dash.year) && S.dash.year !== 'All') S.dash.year = years[0] || 'All';
  draw();
}

/* ---------- shared: editable cells ---------- */
const siteList = () => `<datalist id="siteList">${S.sites.map((s) => `<option value="${esc(s.name)}"></option>`).join('')}</datalist>`;
const recruiterOpts = (cur) => ['', ...(S.settings.recruiters || [])].concat(cur && !(S.settings.recruiters || []).includes(cur) ? [cur] : []).map((r) => `<option ${r === cur ? 'selected' : ''}>${esc(r)}</option>`).join('');
// Excel-style keys: Enter / arrows move between cells, pasting several lines from Excel fills down
function gridKeys(root) {
  const cells = () => $$('tbody [data-f]', root);
  root.addEventListener('keydown', (e) => {
    const el = e.target; if (!el.matches || !el.matches('[data-f]')) return;
    const tr = el.closest('tr'), td = el.closest('td'), col = [...tr.children].indexOf(td);
    const go = (row) => { const t = row && row.children[col] && row.children[col].querySelector('[data-f]'); if (t) { e.preventDefault(); t.focus(); t.select && t.select(); } };
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && el.tagName !== 'SELECT')) go(tr.nextElementSibling);
    else if (e.key === 'ArrowUp' && el.tagName !== 'SELECT') go(tr.previousElementSibling);
    else if (e.key === 'ArrowRight' && el.selectionStart === (el.value || '').length) { const n = cells(); const i = n.indexOf(el); if (n[i + 1] && n[i + 1].closest('tr') === tr) { e.preventDefault(); n[i + 1].focus(); } }
    else if (e.key === 'ArrowLeft' && el.selectionStart === 0) { const n = cells(); const i = n.indexOf(el); if (n[i - 1] && n[i - 1].closest('tr') === tr) { e.preventDefault(); n[i - 1].focus(); } }
  });
  root.addEventListener('paste', (e) => {
    const el = e.target; if (!el.matches || !el.matches('input[data-f]')) return;
    const lines = (e.clipboardData.getData('text') || '').replace(/\r/g, '').split('\n').filter((x, i, a) => x !== '' || i < a.length - 1);
    if (lines.length < 2) return;
    e.preventDefault(); let tr = el.closest('tr'); const col = [...tr.children].indexOf(el.closest('td'));
    for (const line of lines) { const t = tr && tr.children[col] && tr.children[col].querySelector('input[data-f]'); if (!t) break; t.value = line.split('\t')[0]; t.dispatchEvent(new Event('change')); tr = tr.nextElementSibling; }
    toast(`Pasted ${lines.length} rows.`);
  });
}
function bindEdits(table, root, onSaved) {
  if (!root._grid) { gridKeys(root); root._grid = true; }
  $$('[data-f]', root).forEach((el) => el.addEventListener('change', async () => {
    const id = el.closest('tr').dataset.id, f = el.dataset.f; let v = el.value.trim() || null;
    const patch = { [f]: v };
    if (f === 'rate' && v) patch.rate = Number(v.replace('£', ''));
    if (f === 'site') { const s = S.sites.find((x) => x.name.toLowerCase() === (v || '').toLowerCase()); patch.site_id = s ? s.id : null; if (v && !s) toast('Site not in the contract list. Client emails need a listed site.', true); }
    const { error } = await sb.from(table).update(patch).eq('id', id);
    if (error) toast('Not saved: ' + error.message, true); else { el.style.borderColor = 'var(--filled)'; setTimeout(() => (el.style.borderColor = ''), 900); onSaved && onSaved(id, patch); }
  }));
}
const chip = (v, map) => `<span class="chip" style="--c:var(${map[v] || '--hold'})">${esc(v || '—')}</span>`;
const EMAILC = { Sent: '--filled', Pending: '--prog', Skipped: '--hold', 'Not sent': '--hold', Failed: '--danger', Historic: '--hold' };

/* ---------- email modal ---------- */
async function emailModal(template, id, after) {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Email preview"><h2>Preparing email…</h2></div>`;
  let pv; try { pv = await callFn('send-email', { template, id, dry_run: true }); } catch (e) { m.innerHTML = `<div class="box"><h2>Can't prepare this email</h2><p class="err">${esc(e.message)}</p><button class="btn" id="mClose">Close</button></div>`; $('#mClose').onclick = () => (m.hidden = true); return; }
  const extra = [];
  const ccHtml = () => [...pv.cc.map((c) => `<span>${esc(c)}</span>`), ...extra.map((c, i) => `<span>${esc(c)}<button data-rm="${i}" aria-label="Remove ${esc(c)}">×</button></span>`)].join('');
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Email preview">
    <h2>${template === 'cover_client' ? 'Email to client' : template === 'hire_cleaner' ? 'Hire email to cleaner' : 'Cover email to cleaner'}</h2>
    <div class="muted">From ${esc(pv.from)}<br>To ${esc(pv.to.join(', '))}</div>
    <div><div class="soft" style="font-size:12px;margin-bottom:6px">CC</div><div class="ccs" id="ccs">${ccHtml()}</div>
      <div class="row" style="margin-top:8px"><input type="email" id="ccIn" placeholder="Add CC email" aria-label="Add CC email" style="flex:1"><button class="btn sm" id="ccAdd">Add CC</button></div></div>
    <label class="f">Subject<input id="mSub" value="${esc(pv.subject)}"></label>
    <label class="f">Message<textarea id="mBody">${esc(pv.text)}</textarea></label>
    <div class="row"><input id="mAIi" placeholder="Optional: tell AI how to change it (e.g. shorter, friendlier)" style="flex:1"><button type="button" class="btn" id="mAI">✨ Improve with AI</button></div>
    <div class="row" style="justify-content:flex-end">${template === 'cover_client' ? '<button class="btn" id="mSkip">Skip client email</button>' : ''}<button class="btn" id="mClose">Cancel</button><button class="btn pri" id="mSend">Send email</button></div></div>`;
  $('#ccAdd').onclick = () => { const v = $('#ccIn').value.trim(); if (/^\S+@\S+\.\S+$/.test(v)) { extra.push(v); $('#ccIn').value = ''; $('#ccs').innerHTML = ccHtml(); } else toast('That email address looks wrong.', true); };
  $('#ccs').onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { extra.splice(+b.dataset.rm, 1); $('#ccs').innerHTML = ccHtml(); } };
  $('#mAI').onclick = async () => { const b = $('#mAI'); b.disabled = true; b.textContent = 'Drafting…'; try { const r = await callFn('ai', { action: 'draft', kind: template, text: $('#mBody').value, instructions: $('#mAIi').value }); $('#mBody').value = r.text; toast('AI draft ready. Check it, then Send.'); } catch (e) { toast(e.message, true); } b.disabled = false; b.textContent = '✨ Improve with AI'; };
  $('#mClose').onclick = () => (m.hidden = true);
  if ($('#mSkip')) $('#mSkip').onclick = async () => { await sb.from('covers').update({ client_email_status: 'Skipped' }).eq('id', id); m.hidden = true; toast('Client email skipped.'); after && after(); };
  $('#mSend').onclick = async () => {
    $('#mSend').disabled = true; $('#mSend').textContent = 'Sending…';
    try { await callFn('send-email', { template, id, extra_cc: extra, subject_override: $('#mSub').value, body_override: $('#mBody').value }); m.hidden = true; toast('Email sent.'); after && after(); }
    catch (e) { toast(e.message, true); $('#mSend').disabled = false; $('#mSend').textContent = 'Send email'; }
  };
}

/* ---------- new hiring ---------- */
async function pageHiring() {
  const edit = can('recruitment', 'edit'), send = canFlag('recruitment', 'can_send_email');
  shell(`<div class="head"><div><div class="soft">Recruitment</div><h1>New hiring</h1></div><div class="row">
    <label class="f">Search<input id="hS" placeholder="Site, contract or candidate"></label>
    <label class="f">Recruiter<select id="hR"><option value="">All</option>${(S.settings.recruiters || []).map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
    <label class="f">Status<select id="hT"><option value="">All</option>${STATUSES.map((s) => `<option>${s}</option>`).join('')}</select></label>
    ${trackerBtn()}${edit ? '<button class="btn pri" id="hAdd">Add requirement</button>' : ''}${canFlag('recruitment', 'can_export') ? '<button class="btn" id="hExp">Export CSV</button>' : ''}${themeSwitch()}</div></div>
    <div class="tablewrap" id="hWrap">${SKEL}</div>${siteList()}`);
  let rows = await fetchAll('hires', '*', (q) => q.order('raised_on', { ascending: false, nullsFirst: true }));
  if (!$('#hWrap')) return;
  const SC = { Filled: '--filled', Offer: '--offer', 'In Progress': '--prog', Vacant: '--unplanned', 'On Hold': '--hold' };
  const draw = () => {
    const s = $('#hS').value.toLowerCase(), r = $('#hR').value, t = $('#hT').value;
    const list = rows.filter((x) => (!s || [x.site, x.contract, x.candidate].join(' ').toLowerCase().includes(s)) && (!r || x.recruiter === r) && (!t || x.status === t));
    const inp = (x, f, type = 'text', extra = '') => edit ? `<input data-f="${f}" type="${type}" value="${esc(x[f] ?? '')}" ${extra} aria-label="${f}">` : esc(x[f] ?? '');
    $('#hWrap').innerHTML = `<table><thead><tr><th>Raised</th><th>Site</th><th>Area Manager</th><th>Role</th><th>Rate £</th><th>DBS</th><th>Type</th><th>Recruiter</th><th>Status</th><th>Start</th><th>Candidate</th><th>Candidate email</th><th>Source</th><th>Notes</th><th>Email</th></tr></thead><tbody>
      ${list.map((x) => `<tr data-id="${x.id}"><td>${inp(x, 'raised_on', 'date')}</td><td>${inp(x, 'site', 'text', 'list="siteList" style="min-width:200px"')}</td><td>${inp(x, 'area_manager')}</td><td>${inp(x, 'role')}</td><td>${inp(x, 'rate', 'text', 'style="min-width:70px"')}</td><td>${inp(x, 'dbs')}</td>
        <td>${edit ? `<select data-f="hire_type"><option ${x.hire_type === 'Permanent' ? 'selected' : ''}>Permanent</option><option ${x.hire_type === 'Cover' ? 'selected' : ''}>Cover</option></select>` : esc(x.hire_type)}</td>
        <td>${edit ? `<select data-f="recruiter">${recruiterOpts(x.recruiter)}</select>` : esc(x.recruiter)}</td>
        <td>${edit ? `<select data-f="status">${STATUSES.map((s2) => `<option ${s2 === x.status ? 'selected' : ''}>${s2}</option>`).join('')}</select>` : chip(x.status, SC)}</td>
        <td>${inp(x, 'start_date', 'date')}</td><td>${inp(x, 'candidate')}</td><td>${inp(x, 'candidate_email', 'email')}</td><td>${edit ? `<select data-f="source"><option></option>${SOURCES.map((o) => `<option ${x.source === o ? 'selected' : ''}>${o}</option>`).join('')}</select>` : esc(x.source || '')}</td><td>${inp(x, 'notes', 'text', 'style="min-width:180px"')}</td>
        <td style="white-space:nowrap">${chip(x.hire_email_status, EMAILC)} ${send && x.status === 'Filled' ? `<button class="btn sm" data-mail="${x.id}">Send</button>` : ''}${canFlag('recruitment', 'can_delete') ? ` <button class="btn sm" data-del="${x.id}" aria-label="Delete row">Delete</button>` : ''}</td></tr>`).join('')}</tbody></table>
      <div class="pager">${list.length} of ${rows.length} rows</div>`;
    bindEdits('hires', $('#hWrap'), (id, patch) => { Object.assign(rows.find((x) => x.id === id), patch); if ('status' in patch) draw(); });
    $$('[data-del]').forEach((b) => (b.onclick = async () => { if (!confirm('Delete this requirement?')) return; const { error } = await sb.from('hires').delete().eq('id', b.dataset.del); if (error) return toast(error.message, true); rows = rows.filter((r) => r.id !== b.dataset.del); draw(); toast('Deleted.'); }));
    $$('[data-mail]').forEach((b) => (b.onclick = () => emailModal('hire_cleaner', b.dataset.mail, async () => { rows = await fetchAll('hires', '*', (q) => q.order('raised_on', { ascending: false, nullsFirst: true })); draw(); })));
  };
  ['#hS', '#hR', '#hT'].forEach((s) => $(s).addEventListener('input', draw));
  if ($('#hAdd')) $('#hAdd').onclick = async () => {
    const { data, error } = await sb.from('hires').insert({ raised_on: new Date().toISOString().slice(0, 10), status: 'Vacant', hire_type: 'Permanent', created_by: S.user.id }).select().single();
    if (error) return toast(error.message, true); rows.unshift(data); draw(); $('#hWrap input[data-f=site]').focus();
  };
  if ($('#hExp')) $('#hExp').onclick = () => downloadCsv('hires.csv', rows);
  draw();
}

/* ---------- covers ---------- */
async function pageCovers() {
  const edit = can('covers', 'edit'), send = canFlag('covers', 'can_send_email');
  const st = (S.cov ||= { kind: 'Unplanned', month: new Date().toISOString().slice(0, 7), rec: '', cl: '', page: 0, sel: new Set() });
  shell(`<div class="head"><div><div class="soft">Recruitment and Customer Care</div><h1>Covers</h1></div><div class="row">
    <label class="f">Month<input type="month" id="cM" value="${st.month}"></label>
    <label class="f">Recruiter<select id="cR"><option value="">All</option>${(S.settings.recruiters || []).map((r) => `<option ${r === st.rec ? 'selected' : ''}>${esc(r)}</option>`).join('')}<option value="__none" ${st.rec === '__none' ? 'selected' : ''}>Unassigned</option></select></label>
    <label class="f">Client email<select id="cC"><option value="">All</option>${['Pending', 'Sent', 'Skipped', 'Failed'].map((x) => `<option ${x === st.cl ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    ${trackerBtn()}<button class="btn" id="cBright" title="Coming with the BrightHR connection">Pull from BrightHR</button>${edit ? '<button class="btn pri" id="cAdd">Add cover</button>' : ''}${themeSwitch()}</div></div>
    <div class="tabs" role="tablist">${['Unplanned', 'Planned'].map((k) => `<button role="tab" aria-selected="${st.kind === k}" class="${st.kind === k ? 'on' : ''}" data-kind="${k}">${k} covers</button>`).join('')}</div>
    <div class="grid" id="cKpi"></div>
    <div class="row" id="cBulk"></div>
    <div class="tablewrap" id="cWrap">${SKEL}</div>${siteList()}`);
  const load = async () => {
    let q = sb.from('covers').select('*', { count: 'exact' }).eq('kind', st.kind).order('date_from', { ascending: false, nullsFirst: false });
    if (st.month) { const [y, m] = st.month.split('-').map(Number); q = q.gte('date_from', `${st.month}-01`).lt('date_from', m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`); }
    if (st.rec === '__none') q = q.is('recruiter', null); else if (st.rec) q = q.eq('recruiter', st.rec);
    if (st.cl) q = q.eq('client_email_status', st.cl);
    const { data, count, error } = await q.range(st.page * 100, st.page * 100 + 99);
    if (!$('#cWrap')) return;
    if (error) return toast(error.message, true);
    draw(data, count);
  };
  const draw = (rows, count) => {
    const k = (l, v, c) => `<div class="card kpi" style="--c:var(${c})"><span>${l}</span><b>${v}</b></div>`;
    $('#cKpi').innerHTML = k('Covers on this page', rows.length, '--acc') + k('Cleaner emails sent', rows.filter((r) => r.cleaner_email_status === 'Sent').length, '--planned') + k('Client emails sent', rows.filter((r) => r.client_email_status === 'Sent').length, '--filled') + k('Client emails pending', rows.filter((r) => r.client_email_status === 'Pending').length, '--prog');
    $('#cBulk').innerHTML = `<span class="muted">${st.sel.size} selected</span>${send && canFlag('covers', 'can_bulk_send') ? '<button class="btn sm pri" id="bClean">Send to cleaners</button>' : ''}${canFlag('covers', 'can_delete') ? '<button class="btn sm" id="bDel">Delete selected</button>' : ''}${canFlag('covers', 'can_export') ? '<button class="btn sm" id="bExp">Export this page</button>' : ''}<span class="soft">Client emails are sent by Customer Care.</span>`;
    if ($('#bDel')) $('#bDel').onclick = async () => { if (!st.sel.size) return toast('Tick rows first.', true); if (!confirm(`Delete ${st.sel.size} cover row(s)? This can't be undone.`)) return; const { error } = await sb.from('covers').delete().in('id', [...st.sel]); toast(error ? error.message : 'Deleted.', !!error); st.sel.clear(); load(); };
    if ($('#bExp')) $('#bExp').onclick = () => downloadCsv(`covers-${st.kind}-${st.month || 'all'}.csv`, rows);
    const inp = (x, f, type = 'text', extra = '') => edit ? `<input data-f="${f}" type="${type}" value="${esc(x[f] ?? '')}" ${extra} aria-label="${f}">` : esc(x[f] ?? '');
    $('#cWrap').innerHTML = `<table><thead><tr><th><input type="checkbox" id="cAll" aria-label="Select all"></th><th>From</th><th>To</th><th>Site</th><th>Absent</th><th>Cover cleaner</th><th>Cleaner email</th><th>Shift</th><th>Rate £</th><th>DBS no.</th><th>DBS issued</th><th>Reason</th><th>Recruiter</th><th>Cleaner</th><th>Client</th><th></th></tr></thead><tbody>
      ${rows.map((x) => `<tr data-id="${x.id}"><td><input type="checkbox" data-sel="${x.id}" ${st.sel.has(x.id) ? 'checked' : ''} aria-label="Select row"></td>
        <td>${inp(x, 'date_from', 'date')}</td><td>${inp(x, 'date_to', 'date')}</td><td>${inp(x, 'site', 'text', 'list="siteList" style="min-width:200px"')}</td><td>${inp(x, 'absent_cleaner')}</td><td>${inp(x, 'cover_cleaner')}</td><td>${inp(x, 'cover_email', 'email')}</td>
        <td>${inp(x, 'shift')}</td><td>${inp(x, 'rate', 'text', 'style="min-width:70px"')}</td><td>${inp(x, 'dbs_number')}</td><td>${inp(x, 'dbs_issue_date', 'date')}</td><td>${inp(x, 'reason')}</td>
        <td>${edit ? `<select data-f="recruiter">${recruiterOpts(x.recruiter)}</select>` : esc(x.recruiter)}</td>
        <td>${chip(x.cleaner_email_status, EMAILC)}</td><td>${chip(x.client_email_status, EMAILC)}</td>
        <td style="white-space:nowrap">${send ? `<button class="btn sm" data-ce="${x.id}">Email cleaner</button>` : ''}</td></tr>`).join('')}</tbody></table>
      <div class="pager"><span>${count ? st.page * 100 + 1 : 0}–${st.page * 100 + rows.length} of ${fmtN(count)}</span><button class="btn sm" id="pPrev" ${st.page ? '' : 'disabled'}>Previous</button><button class="btn sm" id="pNext" ${(st.page + 1) * 100 < count ? '' : 'disabled'}>Next</button></div>`;
    bindEdits('covers', $('#cWrap'));
    $$('[data-sel]').forEach((c) => (c.onchange = () => { c.checked ? st.sel.add(c.dataset.sel) : st.sel.delete(c.dataset.sel); $('#cBulk span').textContent = st.sel.size + ' selected'; }));
    $('#cAll').onchange = (e) => { rows.forEach((r) => (e.target.checked ? st.sel.add(r.id) : st.sel.delete(r.id))); load(); };
    $$('[data-ce]').forEach((b) => (b.onclick = () => emailModal('cover_cleaner', b.dataset.ce, load)));
    $$('[data-cl]').forEach((b) => (b.onclick = () => emailModal('cover_client', b.dataset.cl, load)));
    $('#pPrev').onclick = () => { st.page--; load(); }; $('#pNext').onclick = () => { st.page++; load(); };
    if (send && $('#bClean')) {
      const bulk = async (template) => {
        if (!st.sel.size) return toast('Tick at least one cover first.', true);
        if (!confirm(`Send ${st.sel.size} email(s) now?`)) return;
        let ok = 0, fail = [];
        for (const id of st.sel) { try { await callFn('send-email', { template, id }); ok++; } catch (e) { fail.push(e.message); } }
        toast(`${ok} sent${fail.length ? `, ${fail.length} failed: ${fail[0]}` : ''}.`, !!fail.length); st.sel.clear(); load();
      };
      $('#bClean').onclick = () => bulk('cover_cleaner');
    }
  };
  $$('[data-kind]').forEach((b) => (b.onclick = () => { st.kind = b.dataset.kind; st.page = 0; st.sel.clear(); pageCovers(); }));
  $('#cM').onchange = (e) => { st.month = e.target.value; st.page = 0; load(); };
  $('#cR').onchange = (e) => { st.rec = e.target.value; st.page = 0; load(); };
  $('#cC').onchange = (e) => { st.cl = e.target.value; st.page = 0; load(); };
  $('#cBright').onclick = () => {
    if (!can('covers', 'edit') || !canFlag('covers', 'can_import')) return toast('You need Import permission on Covers to pull from BrightHR.', true);
    const m = $('#modal'); m.hidden = false; const today = new Date().toISOString().slice(0, 10), wk = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    m.innerHTML = `<form class="box" id="pullF" role="dialog" aria-modal="true" aria-label="Pull from BrightHR"><h2>Pull absences from BrightHR</h2>
      <p class="muted" style="margin:0">Approved absences in this date range become cover rows. Ones already pulled are skipped.</p>
      <div class="row"><label class="f">From<input type="date" name="from" value="${today}" required></label><label class="f">To<input type="date" name="to" value="${wk}" required></label>
      <label class="f">Assign to<select name="recruiter">${recruiterOpts((S.settings.recruiters || []).find((r) => S.profile.full_name.includes(r)) || '')}</select></label></div>
      <fieldset style="border:1px solid var(--border);border-radius:10px;padding:10px 14px"><legend class="soft">Types</legend>
      ${['Sickness', 'Holiday', 'Other', 'Toil'].map((t) => `<label style="margin-right:16px"><input type="checkbox" name="t" value="${t}" ${t !== 'Toil' ? 'checked' : ''}> ${t}</label>`).join('')}</fieldset>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" id="pClose">Cancel</button><button class="btn pri">Pull absences</button></div></form>`;
    $('#pClose').onclick = () => (m.hidden = true);
    $('#pullF').onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(e.target); const b = e.target.querySelector('.pri'); b.disabled = true; b.textContent = 'Pulling…';
      try { const r = await callFn('brighthr-sync', { action: 'pull', from: f.get('from'), to: f.get('to'), recruiter: f.get('recruiter') || null, types: f.getAll('t') });
        m.hidden = true; toast(`${r.created} new cover row(s) added from BrightHR.`); st.page = 0; load(); }
      catch (er) { toast(er.message, true); b.disabled = false; b.textContent = 'Pull absences'; }
    };
  };
  if ($('#cAdd')) $('#cAdd').onclick = async () => {
    const { error } = await sb.from('covers').insert({ kind: st.kind, date_from: new Date().toISOString().slice(0, 10), recruiter: (S.settings.recruiters || []).find((r) => S.profile.full_name.includes(r)) || null });
    if (error) return toast(error.message, true); st.page = 0; st.month = new Date().toISOString().slice(0, 7); $('#cM').value = st.month; load();
  };
  load();
}

/* ---------- shared cover logic ---------- */
const coverState = (c) => {
  const t = `${c.cover_cleaner || ''} ${c.notes || ''}`.toLowerCase();
  if (/no need|not required|cancel/.test(t)) return 'not needed';
  if (!c.cover_cleaner || /missed|did not attend|didn't attend|did not reach|no show/.test(t)) return 'missed';
  return 'covered';
};
const monthBounds = (ym) => { const [y, m] = ym.split('-').map(Number); const end = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; return [`${ym}-01`, `${end}-01`]; };
const prevMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const pct = (a, b) => (b ? Math.round((a - b) / b * 100) : null);
const delta = (d, goodWhenDown = true) => d == null ? '' : `<span class="delta ${(d > 0) === goodWhenDown ? 'up' : 'down'}">${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${Math.abs(d)}% vs last month</span>`;
const topN = (arr, key, n = 5) => Object.entries(arr.reduce((o, x) => { const k = key(x); if (k) o[k] = (o[k] || 0) + 1; return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, n);

/* ---------- operations overview ---------- */
async function pageHome() {
  const st = (S.home ||= { month: new Date().toISOString().slice(0, 7), member: 'All' });
  shell(`<div class="head"><div><div class="soft">Good ${new Date().getHours() < 12 ? 'morning' : 'afternoon'}, ${esc(S.profile.full_name.split(' ')[0])}</div><h1>Operations overview</h1></div><div class="row">
    <label class="f">Month<input type="month" id="oM" value="${st.month}"></label>
    <label class="f">Team member<select id="oP"><option value="All">Whole team</option>${(S.settings.recruiters || []).map((r) => `<option ${st.member === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>${reportBar('oR')}</div></div>
    <div id="oBody">${SKEL}</div>`);
  $('#oM').onchange = (e) => { st.month = e.target.value; pageHome(); };
  $('#oP').onchange = (e) => { st.member = e.target.value; pageHome(); };
  const [a, b] = monthBounds(st.month), [pa] = monthBounds(prevMonth(st.month));
  const six = new Date(a); six.setMonth(six.getMonth() - 5); const sixStr = six.toISOString().slice(0, 10);
  const who = (r) => st.member === 'All' || r === st.member;
  const q = [];
  q.push(can('covers') || can('customer_care') ? fetchAll('covers', 'id,kind,date_from,date_to,site,recruiter,cover_cleaner,absent_cleaner,reason,notes,client_email_status,cleaner_email_status', (x) => x.gte('date_from', sixStr).lt('date_from', b)) : Promise.resolve([]));
  q.push(can('recruitment') ? fetchAll('hires', 'id,site,status,raised_on,start_date,recruiter,role,candidate') : Promise.resolve([]));
  q.push(can('contracts') ? fetchAll('contracts', 'id,name,start_date,end_date,year1_rate,year2_rate,area_manager') : Promise.resolve([]));
  q.push(can('training') ? sb.from('training_results').select('passed').then((r) => r.data || []) : Promise.resolve([]));
  q.push(can('training') ? sb.from('training_links').select('token', { count: 'exact', head: true }).then((r) => r.count || 0) : Promise.resolve(0));
  q.push(can('finance') ? fetchAll('pl_entries', 'contract_id,month,revenue,labour_cost,materials,other_costs').catch(() => []) : Promise.resolve([]));
  q.push(can('brighthr') ? sb.from('brighthr_absences').select('employee,type,display_name,date_from,date_to').lte('date_from', new Date().toISOString().slice(0, 10)).gte('date_to', new Date().toISOString().slice(0, 10)).then((r) => r.data || []) : Promise.resolve([]));
  const [allC, H, K, TR, TL, PL, OFF] = await Promise.all(q);
  if (!$('#oBody')) return;
  const C6 = allC.filter((c) => who(c.recruiter));
  const C = C6.filter((c) => c.date_from >= a && c.date_from < b), P = C6.filter((c) => c.date_from >= pa && c.date_from < a);
  const needed = C.filter((c) => coverState(c) !== 'not needed'), missed = C.filter((c) => coverState(c) === 'missed');
  const unp = C.filter((c) => c.kind === 'Unplanned').length, unpP = P.filter((c) => c.kind === 'Unplanned').length;
  const share = C.length ? Math.round(unp / C.length * 100) : 0, shareP = P.length ? Math.round(unpP / P.length * 100) : 0;
  const coverRate = needed.length ? Math.round((needed.length - missed.length) / needed.length * 100) : 0;
  const open = H.filter((h) => h.status && h.status !== 'Filled' && who(h.recruiter));
  const pendingCC = C.filter((c) => c.client_email_status === 'Pending' && c.cover_cleaner && coverState(c) === 'covered').length;
  const passed = TR.filter((r) => r.passed).length, trainPct = TL ? Math.round(passed / TL * 100) : null;
  const today = new Date(), soon = new Date(Date.now() + 45 * 864e5);
  const y2 = K.filter((k) => k.start_date).map((k) => { const d = new Date(k.start_date); while (d < today) d.setFullYear(d.getFullYear() + 1); return { ...k, due: d }; }).filter((k) => k.due <= soon).sort((x, y) => x.due - y.due);
  const topSites = topN(C, (c) => c.site, 5), topMissed = topN(missed, (c) => c.site, 6);
  const recTop = topN(allC.filter((c) => c.date_from >= a && c.date_from < b), (c) => c.recruiter, 1)[0];
  const byDay = topN(C, (c) => c.date_from, 1)[0];
  const oldest = open.filter((h) => h.raised_on).sort((x, y) => x.raised_on.localeCompare(y.raised_on))[0];
  // sites needing covers in each of the last 3 months
  const m3 = [prevMonth(prevMonth(st.month)), prevMonth(st.month), st.month];
  const repeat = Object.entries(C6.reduce((o, c) => { if (c.site) { (o[c.site] ||= new Set()).add(c.date_from.slice(0, 7)); } return o; }, {})).filter(([, s]) => m3.every((m) => s.has(m))).map(([n]) => [n, C6.filter((c) => c.site === n && m3.includes(c.date_from.slice(0, 7))).length]).sort((x, y) => y[1] - x[1]).slice(0, 6);
  const sickTop = topN(C.filter((c) => c.kind === 'Unplanned'), (c) => c.site, 1)[0];
  const m6 = [...Array(6)].map((_, i) => { const d = new Date(a); d.setMonth(d.getMonth() - 5 + i); return d.toISOString().slice(0, 7); });
  const sp = { covers: m6.map((m) => C6.filter((c) => c.date_from.startsWith(m)).length), missed: m6.map((m) => C6.filter((c) => c.date_from.startsWith(m) && coverState(c) === 'missed').length), unp: m6.map((m) => { const x = C6.filter((c) => c.date_from.startsWith(m)); return x.length ? x.filter((c) => c.kind === 'Unplanned').length / x.length : 0; }) };
  const k = (l, v, sub, c, s, dk = '') => `<div class="card kpi${dk ? ' click' : ''}" style="--c:var(${c})" ${dk}><span>${l}</span><b>${v}</b>${s ? spark(s) : ''}<small>${sub}</small></div>`;
  const KN = new Map(K.map((x) => [x.id, x]));
  const plLast = PL.length ? PL.map((p) => p.month).sort().pop() : null;
  const plRows = PL.filter((p) => p.month === plLast).map((p) => ({ ...p, contract: KN.get(p.contract_id)?.name || '', am: KN.get(p.contract_id)?.area_manager || '', margin: Math.round((+p.revenue || 0) - (+p.labour_cost || 0) - (+p.materials || 0) - (+p.other_costs || 0)) }));
  const PLC = [['contract', 'Contract'], ['am', 'Area Manager'], ['revenue', 'Revenue £'], ['labour_cost', 'Labour £'], ['margin', 'Margin £']];
  const spot = (l, name, num, c, dk = '') => `<div class="card${dk ? ' click' : ''}" style="--c:var(${c})" ${dk}><span class="soft">${l}</span><span class="name">${esc(name || '—')}</span><span class="num">${num || ''}</span></div>`;
  let li = 0;
  const list = (rows, empty, dfn) => rows.length ? `<div class="list">${rows.map(([n, v]) => { const d = dfn ? dfn(n) : null; return `<div ${d ? dset('l' + (li++), d[0], d[1], d[2]) + ' class="click"' : ''}><span>${esc(n)}</span><b>${esc(v)}</b></div>`; }).join('')}</div>` : `<p class="muted">${empty}</p>`;
  const mName = new Date(a).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  $('#oBody').outerHTML = `<div style="display:flex;flex-direction:column;gap:16px"><section class="card" id="aiIns"></section>
    <section class="grid">
      ${can('covers') || can('customer_care') ? k('Covers this month', fmtN(C.length), delta(pct(C.length, P.length)) || mName, '--acc', sp.covers, dset('hc', `Covers · ${mName}`, C, COLS.cover)) : ''}
      ${can('covers') ? k('Missed covers', fmtN(missed.length), `${coverRate}% of needed covers filled`, '--danger', sp.missed, dset('hm', `Missed covers · ${mName}`, missed, COLS.cover)) : ''}
      ${can('covers') ? k('Unplanned share', share + '%', P.length ? `<span class="delta ${share > shareP ? 'up' : 'down'}">${share > shareP ? '▲' : share < shareP ? '▼' : '•'} ${Math.abs(share - shareP)} pts vs last month</span>` : 'sickness and same day', '--unplanned', sp.unp, dset('hu', `Unplanned covers · ${mName}`, C.filter((c) => c.kind === 'Unplanned'), COLS.cover)) : ''}
      ${can('recruitment') ? k('Open roles', fmtN(open.length), oldest ? `oldest open ${Math.round((today - new Date(oldest.raised_on)) / 864e5)} days` : 'none open', '--prog', null, dset('ho', 'Open roles', open, COLS.hire)) : ''}
      ${can('customer_care') || can('covers') ? k('Client emails pending', fmtN(pendingCC), 'covered but client not told', '--offer', null, dset('hp', `Client emails pending · ${mName}`, C.filter((c) => c.client_email_status === 'Pending' && c.cover_cleaner && coverState(c) === 'covered'), COLS.cover)) : ''}
      ${can('training') ? k('Safeguarding trained', trainPct == null ? '—' : trainPct + '%', `${passed} of ${TL} links passed`, '--filled') : ''}
      ${can('contracts') ? k('Year 2 price due', fmtN(y2.length), 'contract anniversaries in 45 days', '--raised', null, dset('hy', 'Contract anniversaries in 45 days', y2, [['name', 'Contract'], ['area_manager', 'Area Manager'], ['start_date', 'Started'], ['due', 'Anniversary', (r) => r.due.toLocaleDateString('en-GB')], ['year1_rate', 'Year 1 £/hr'], ['year2_rate', 'Year 2 £/hr']])) : ''}
      ${can('brighthr') ? k('Off today', fmtN(OFF.length), OFF.filter((o) => o.type === 'Sickness').length + ' off sick (BrightHR)', '--unplanned', null, dset('hb', 'Off today (BrightHR)', OFF, [['employee', 'Name'], ['type', 'Type'], ['display_name', 'Reason'], ['date_from', 'From'], ['date_to', 'To']])) : ''}
      ${can('finance') && PL.length ? (() => { const lm = PL.map((p) => p.month).sort().pop(); const r = PL.filter((p) => p.month === lm).map((p) => (+p.revenue || 0) - (+p.labour_cost || 0) - (+p.materials || 0) - (+p.other_costs || 0)); const rev = PL.filter((p) => p.month === lm).reduce((t, p) => t + (+p.revenue || 0), 0); return k('Loss-making contracts', r.filter((x) => x < 0).length, `${new Date(lm).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })} · margin ${rev ? Math.round(r.reduce((t, x) => t + x, 0) / rev * 100) : 0}%`, '--danger', null, dset('hl', 'Loss-making contracts', plRows.filter((x) => x.margin < 0).sort((x, y) => x.margin - y.margin), PLC)); })() : ''}
    </section>
    ${can('covers') || can('customer_care') ? `<section class="spot">
      ${spot('Site needing most covers', topSites[0]?.[0], topSites[0] ? topSites[0][1] + ' covers in ' + mName : '', '--unplanned', topSites[0] ? dset('s1', `Covers at ${topSites[0][0]}`, C.filter((c) => c.site === topSites[0][0]), COLS.cover) : '')}
      ${spot('Most sickness cover', sickTop?.[0], sickTop ? sickTop[1] + ' unplanned covers' : '', '--danger', sickTop ? dset('s2', `Unplanned covers at ${sickTop[0]}`, C.filter((c) => c.site === sickTop[0] && c.kind === 'Unplanned'), COLS.cover) : '')}
      ${spot('Top recruiter this month', recTop?.[0], recTop ? recTop[1] + ' covers arranged' : '', '--filled', recTop ? dset('s3', `Covers arranged by ${recTop[0]}`, allC.filter((c) => c.recruiter === recTop[0] && c.date_from >= a && c.date_from < b), COLS.cover) : '')}
      ${spot('Busiest day', byDay ? new Date(byDay[0]).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }) : '', byDay ? byDay[1] + ' covers started' : '', '--planned', byDay ? dset('s4', `Covers starting ${byDay[0]}`, C.filter((c) => c.date_from === byDay[0]), COLS.cover) : '')}
    </section>` : ''}
    <section class="charts">
      ${can('covers') || can('customer_care') ? `<div class="card"><h2>Top 5 sites needing covers</h2><canvas id="oTop"></canvas></div>
      <div class="card"><h2>Missed sites this month</h2><p class="soft" style="margin:0 0 6px">No cover arranged, or cover didn't turn up</p>${list(topMissed.map(([n, v]) => [n, v + ' missed']), 'No missed covers this month. 👏', (n) => [`Missed covers at ${n}`, missed.filter((c) => c.site === n), COLS.cover])}</div>
      <div class="card wide"><h2>Covers per day · ${mName}</h2><canvas id="oDay" height="70"></canvas></div>
      <div class="card"><h2>Last 6 months</h2><canvas id="oSix"></canvas></div>
      <div class="card"><h2>Repeat problem sites</h2><p class="soft" style="margin:0 0 6px">Needed covers in each of the last 3 months</p>${list(repeat.map(([n, v]) => [n, v + ' covers']), 'No site needed covers three months running.', (n) => [`Covers at ${n} · last 3 months`, C6.filter((c) => c.site === n && m3.includes(c.date_from.slice(0, 7))), COLS.cover])}</div>` : ''}
      ${can('recruitment') ? `<div class="card"><h2>Open vacancies by site</h2>${list(topN(open, (h) => h.site, 8).map(([n, v]) => [n, v + ' open']), 'No open vacancies.', (n) => [`Open roles at ${n}`, open.filter((h) => h.site === n), COLS.hire])}</div>` : ''}
      ${can('contracts') ? `<div class="card"><h2>Year 2 pricing due</h2><p class="soft" style="margin:0 0 6px">Check the invoice moves to the Year 2 rate</p>${list(y2.slice(0, 8).map((x) => [x.name, x.due.toLocaleDateString('en-GB')]), 'No anniversaries in the next 45 days.')}</div>` : ''}
    </section></div>`;
  aiInsightsCard();
  $('#oRX').onclick = () => downloadReport(`Crystal FM operations overview ${st.month}`, [{ Measure: 'Covers this month', Value: C.length }, { Measure: 'Missed covers', Value: missed.length }, { Measure: 'Cover fill rate %', Value: coverRate }, { Measure: 'Unplanned share %', Value: share }, { Measure: 'Open roles', Value: open.length }, { Measure: 'Client emails pending', Value: pendingCC }, { Measure: 'Safeguarding trained %', Value: trainPct ?? '' }, { Measure: 'Year 2 price due (45 days)', Value: y2.length }, { Measure: 'Month', Value: st.month }, { Measure: 'Team member', Value: st.member }]);
  if (!(can('covers') || can('customer_care'))) return;
  Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border'); Chart.defaults.font.family = "'Geist', sans-serif";
  S.charts.push(new Chart($('#oTop'), { type: 'bar', data: { labels: topSites.map((x) => x[0].length > 26 ? x[0].slice(0, 25) + '…' : x[0]), datasets: [
    { label: 'Covered', data: topSites.map(([n]) => C.filter((c) => c.site === n && coverState(c) !== 'missed').length), backgroundColor: cssv('--acc'), borderRadius: 6, stack: 's' },
    { label: 'Missed', data: topSites.map(([n]) => C.filter((c) => c.site === n && coverState(c) === 'missed').length), backgroundColor: cssv('--danger'), borderRadius: 6, stack: 's' }] }, options: { indexAxis: 'y', onClick: (_, el) => { if (el.length) { const n = topSites[el[0].index][0]; dset('c1', `Covers at ${n}`, C.filter((c) => c.site === n), COLS.cover); drill('c1'); } }, onHover: (e, el) => (e.native.target.style.cursor = el.length ? 'pointer' : 'default'), scales: { x: { stacked: true }, y: { stacked: true } } } }));
  const days = []; for (let d = new Date(a); d.toISOString().slice(0, 10) < b; d.setDate(d.getDate() + 1)) days.push(d.toISOString().slice(0, 10));
  S.charts.push(new Chart($('#oDay'), { type: 'bar', data: { labels: days.map((d) => +d.slice(8)), datasets: [
    { label: 'Planned', data: days.map((d) => C.filter((c) => c.date_from === d && c.kind === 'Planned').length), backgroundColor: cssv('--planned'), stack: 's', borderRadius: 3 },
    { label: 'Unplanned', data: days.map((d) => C.filter((c) => c.date_from === d && c.kind === 'Unplanned').length), backgroundColor: cssv('--unplanned'), stack: 's', borderRadius: 3 }] }, options: { onClick: (_, el) => { if (el.length) { const d = days[el[0].index]; dset('c2', `Covers starting ${d}`, C.filter((c) => c.date_from === d), COLS.cover); drill('c2'); } }, onHover: (e, el) => (e.native.target.style.cursor = el.length ? 'pointer' : 'default'), scales: { x: { stacked: true }, y: { stacked: true } } } }));
  const months = [...Array(6)].map((_, i) => { const d = new Date(a); d.setMonth(d.getMonth() - 5 + i); return d.toISOString().slice(0, 7); });
  S.charts.push(new Chart($('#oSix'), { data: { labels: months.map((m) => MN[+m.slice(5) - 1]), datasets: [
    { type: 'bar', label: 'Covers', yAxisID: 'y', data: months.map((m) => C6.filter((c) => c.date_from.startsWith(m)).length), backgroundColor: cssv('--acc'), borderRadius: 6 },
    { type: 'line', label: 'Missed', data: months.map((m) => C6.filter((c) => c.date_from.startsWith(m) && coverState(c) === 'missed').length), borderColor: cssv('--danger'), backgroundColor: cssv('--danger'), yAxisID: 'y2' }] },
    options: { onClick: (_, el) => { if (el.length) { const m = months[el[0].index]; dset('c3', `Covers · ${m}`, C6.filter((c) => c.date_from.startsWith(m)), COLS.cover); drill('c3'); } }, onHover: (e, el) => (e.native.target.style.cursor = el.length ? 'pointer' : 'default'), scales: { y: { position: 'left', beginAtZero: true }, y2: { position: 'right', beginAtZero: true, grid: { display: false } } } } }));
}

/* ---------- customer care ---------- */
async function pageCustomerCare() {
  const send = canFlag('customer_care', 'can_send_email');
  const st = (S.cc ||= { tab: 'Pending', month: new Date().toISOString().slice(0, 7), page: 0, sel: new Set() });
  shell(`<div class="head"><div><div class="soft">Customer Care</div><h1>Client cover emails</h1></div><div class="row">
    <label class="f">Month<input type="month" id="ccM" value="${st.month}"></label>${themeSwitch()}</div></div>
    <section class="grid" id="ccK"></section>
    <section class="charts"><div class="card wide"><h2>Sent vs pending · last 6 months</h2><canvas id="ccChart" height="70"></canvas></div></section>
    <div class="tabs" role="tablist">${['Pending', 'Sent', 'Skipped', 'Failed', 'All'].map((t) => `<button role="tab" data-cct="${t}" aria-selected="${st.tab === t}" class="${st.tab === t ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div class="row" id="ccBulk"></div><div class="tablewrap" id="ccWrap">${SKEL}</div>`);
  $$('[data-cct]').forEach((b) => (b.onclick = () => { st.tab = b.dataset.cct; st.page = 0; st.sel.clear(); pageCustomerCare(); }));
  $('#ccM').onchange = (e) => { st.month = e.target.value; st.page = 0; pageCustomerCare(); };
  const [a, b] = monthBounds(st.month);
  const six = new Date(a); six.setMonth(six.getMonth() - 5);
  const hist = await fetchAll('covers', 'date_from,client_email_status,cover_cleaner,notes', (q) => q.gte('date_from', six.toISOString().slice(0, 10)).lt('date_from', b));
  if (!$('#ccK')) return;
  const cur = hist.filter((c) => c.date_from >= a && coverState(c) === 'covered');
  const k = (l, v, sub, c) => `<div class="card kpi" style="--c:var(${c})"><span>${l}</span><b>${v}</b><small>${sub}</small></div>`;
  const sent = cur.filter((c) => c.client_email_status === 'Sent').length;
  $('#ccK').innerHTML = k('Pending', cur.filter((c) => c.client_email_status === 'Pending').length, 'covered, client not told yet', '--prog') + k('Sent', sent, 'this month', '--filled') + k('Skipped', cur.filter((c) => c.client_email_status === 'Skipped').length, 'client email not needed', '--hold') + k('Sent rate', (cur.length ? Math.round(sent / cur.length * 100) : 0) + '%', 'of covered shifts', '--acc');
  Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border');
  const months = [...Array(6)].map((_, i) => { const d = new Date(a); d.setMonth(d.getMonth() - 5 + i); return d.toISOString().slice(0, 7); });
  const ok = hist.filter((c) => coverState(c) === 'covered');
  S.charts.push(new Chart($('#ccChart'), { type: 'bar', data: { labels: months.map((m) => MN[+m.slice(5) - 1]), datasets: [['Sent', '--filled'], ['Pending', '--prog'], ['Skipped', '--hold']].map(([s, c]) => ({ label: s, data: months.map((m) => ok.filter((x) => x.date_from.startsWith(m) && x.client_email_status === s).length), backgroundColor: cssv(c), stack: 's', borderRadius: 4 })) }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } }));
  const load = async () => {
    let q = sb.from('covers').select('*', { count: 'exact' }).gte('date_from', a).lt('date_from', b).not('cover_cleaner', 'is', null).order('date_from', { ascending: false });
    if (st.tab !== 'All') q = q.eq('client_email_status', st.tab);
    const { data, count, error } = await q.range(st.page * 100, st.page * 100 + 99);
    if (!$('#ccWrap')) return;
    if (error) return toast(error.message, true);
    const rows = data.filter((c) => coverState(c) === 'covered');
    $('#ccBulk').innerHTML = (send ? `<span class="muted" id="ccN">${st.sel.size} selected</span>${canFlag('customer_care', 'can_bulk_send') ? '<button class="btn sm pri" id="ccSend">Send to clients</button>' : ''}<button class="btn sm" id="ccSkip">Skip client email</button>` : '<span class="muted">You can view this list. Ask Syed to allow you to send emails.</span>') + (canFlag('customer_care', 'can_export') ? '<button class="btn sm" id="ccExp">Export</button>' : '');
    if ($('#ccExp')) $('#ccExp').onclick = () => downloadCsv(`client-emails-${st.month}.csv`, rows);
    $('#ccWrap').innerHTML = `<table><thead><tr><th><input type="checkbox" id="ccAll" aria-label="Select all"></th><th>From</th><th>To</th><th>Site</th><th>Cover cleaner</th><th>Covering</th><th>Shift</th><th>DBS no.</th><th>Cleaner email</th><th>Client email</th><th></th></tr></thead><tbody>
      ${rows.map((x) => `<tr data-id="${x.id}"><td><input type="checkbox" data-sel="${x.id}" ${st.sel.has(x.id) ? 'checked' : ''} aria-label="Select"></td><td class="mono">${esc(x.date_from)}</td><td class="mono">${esc(x.date_to || '')}</td><td><strong>${esc(x.site)}</strong></td><td>${esc(x.cover_cleaner)}</td><td>${esc(x.absent_cleaner || '')}</td><td>${esc(x.shift || '')}</td><td>${x.dbs_number ? esc(x.dbs_number) : '<span class="err">missing</span>'}</td>
        <td>${chip(x.cleaner_email_status, EMAILC)}</td><td>${chip(x.client_email_status, EMAILC)}</td><td>${send ? `<button class="btn sm" data-cl="${x.id}">Preview and send</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="11" class="muted" style="padding:20px">Nothing here for this month.</td></tr>'}</tbody></table>
      <div class="pager"><span>${fmtN(count)} rows</span><button class="btn sm" id="ccPrev" ${st.page ? '' : 'disabled'}>Previous</button><button class="btn sm" id="ccNext" ${(st.page + 1) * 100 < count ? '' : 'disabled'}>Next</button></div>`;
    $$('[data-sel]').forEach((c) => (c.onchange = () => { c.checked ? st.sel.add(c.dataset.sel) : st.sel.delete(c.dataset.sel); if ($('#ccN')) $('#ccN').textContent = st.sel.size + ' selected'; }));
    $('#ccAll').onchange = (e) => { rows.forEach((r) => (e.target.checked ? st.sel.add(r.id) : st.sel.delete(r.id))); load(); };
    $$('[data-cl]').forEach((b2) => (b2.onclick = () => emailModal('cover_client', b2.dataset.cl, () => pageCustomerCare())));
    $('#ccPrev').onclick = () => { st.page--; load(); }; $('#ccNext').onclick = () => { st.page++; load(); };
    if (send) {
      if ($('#ccSend')) $('#ccSend').onclick = async () => {
        if (!st.sel.size) return toast('Tick at least one cover first.', true);
        if (!confirm(`Send ${st.sel.size} client email(s) now?`)) return;
        let okN = 0, fail = []; for (const id of st.sel) { try { await callFn('send-email', { template: 'cover_client', id }); okN++; } catch (e) { fail.push(e.message); } }
        toast(`${okN} sent${fail.length ? `, ${fail.length} failed: ${fail[0]}` : ''}.`, !!fail.length); st.sel.clear(); pageCustomerCare();
      };
      $('#ccSkip').onclick = async () => { if (!st.sel.size) return toast('Tick at least one cover first.', true); const { error } = await sb.from('covers').update({ client_email_status: 'Skipped' }).in('id', [...st.sel]); toast(error ? error.message : 'Marked as skipped.', !!error); st.sel.clear(); pageCustomerCare(); };
    }
  };
  load();
}

/* ---------- safeguarding ---------- */
const DEFAULT_Q = [{"q": "What is the main purpose of safeguarding?", "options": ["To protect children from harm and promote their welfare", "To check staff timesheets", "To keep the building clean", "To report maintenance issues"], "answer": 0}, {"q": "Child protection is best described as:", "options": ["A cleaning standard", "Part of safeguarding, protecting children who are suffering or likely to suffer significant harm", "A school uniform policy", "Something only teachers deal with"], "answer": 1}, {"q": "Why is it hard to know exactly how many children are abused?", "options": ["Abuse never happens in schools", "Many cases are never reported and go undetected", "All cases are recorded online", "Children always tell an adult"], "answer": 1}, {"q": "Where can children be abused?", "options": ["Only at home", "Only online", "Anywhere, including home, institutions, the community and online", "Only by strangers in public"], "answer": 2}, {"q": "Who is most likely to abuse a child?", "options": ["Someone the child knows", "A complete stranger", "Another child only", "Nobody, abuse is rare"], "answer": 0}, {"q": "Which of these could be a sign of abuse?", "options": ["A child who is often happy", "Unexplained injuries or a sudden change in behaviour", "A child who likes school", "A child wearing a coat"], "answer": 1}, {"q": "Why might a child not tell anyone about abuse?", "options": ["They fear the abuser or feel they will not be believed", "They always want everyone to know", "They forget about it", "Abuse is not important to them"], "answer": 0}, {"q": "A child tells you something worrying. What should you do?", "options": ["Promise to keep it a secret", "Ask lots of leading questions", "Listen calmly, do not promise secrecy and report it straight away", "Ignore it in case you are wrong"], "answer": 2}, {"q": "Should you promise a child you will keep what they tell you a secret?", "options": ["Yes, always", "No, you must explain you may need to tell someone who can help", "Only if they ask nicely", "Only if it is about a teacher"], "answer": 1}, {"q": "Who should you report a safeguarding concern to at a school site?", "options": ["Another cleaner only", "The child's friends", "The Designated Safeguarding Lead (DSL) and your Crystal FM manager", "Nobody, wait and see"], "answer": 2}, {"q": "When should you write down what you saw or heard?", "options": ["As soon as possible, using the exact words and facts", "A week later", "Only if asked by the police", "Never write anything down"], "answer": 0}, {"q": "You are worried you might be making a false accusation. What should you do?", "options": ["Say nothing", "Report your concern anyway; it is the DSL's job to decide what happens", "Confront the person yourself", "Post about it on social media"], "answer": 1}];
async function pageSafeguarding() {
  const edit = can('training', 'edit'), manage = canFlag('training', 'can_manage') && edit, send = canFlag('training', 'can_send_email');
  const st = (S.sg ||= { tab: 'overview', q: '', status: '' });
  const TABS = [['overview', 'Overview'], ['people', 'People'], ['send', 'Send training'], ['quiz', 'Quiz analysis'], ...(manage ? [['setup', 'Setup']] : [])];
  shell(`<div class="head"><div><div class="soft">Recruitment</div><h1>Safeguarding training</h1><p class="muted" style="margin:2px 0 0">CATS Safeguarding Children Level 1 · 5 videos, quiz and certificate.</p></div><div class="row"><label class="f">Find a person<input id="sgQ" value="${esc(st.q)}" placeholder="Name or email"></label>${edit ? '<button class="btn pri" id="sgNew">Send training</button>' : ''}</div></div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-sgt="${k}" aria-selected="${st.tab === k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="sgBody">${SKEL}</div>`);
  $$('[data-sgt]').forEach((b) => (b.onclick = () => { st.tab = b.dataset.sgt; pageSafeguarding(); }));
  $('#sgQ').onkeydown = (e) => { if (e.key === 'Enter') { st.q = e.target.value; st.tab = 'people'; pageSafeguarding(); } };
  if ($('#sgNew')) $('#sgNew').onclick = () => { st.tab = 'send'; pageSafeguarding(); };
  const [links, res] = await Promise.all([fetchAll('training_links', '*', (q) => q.order('sent_at', { ascending: false })), fetchAll('training_results', '*')]);
  if (!$('#sgBody')) return;
  const T = S.settings.training?.videos?.length ? S.settings.training : { title: 'Safeguarding Children Level 1', pass_mark: 80, videos: ['Aims and learning outcomes', 'Introduction', 'Identifying the signs of abuse', 'Disclosures from children', 'Reporting and recording your concerns'].map((t, i) => ({ title: `Module ${i + 1} · ${t}`, youtube: '' })), questions: S.settings.training?.questions?.length ? S.settings.training.questions : DEFAULT_Q };
  const base = location.origin + location.pathname.replace(/index\.html$/, '') + 'training.html', now = Date.now();
  const R = new Map(res.map((r) => [r.token, r]));
  const rows = links.map((l) => { const r = R.get(l.token) || {}; const status = r.passed ? 'Passed' : r.completed_at ? 'Failed' : (r.modules_watched || 0) > 0 ? 'In progress' : new Date(l.expires_at) < now ? 'Expired' : 'Not started';
    return { ...l, r, status, overdue: !r.passed && now - new Date(l.sent_at) > 3 * 864e5 && status !== 'Expired', refresh: r.refresher_due && new Date(r.refresher_due) - now < 30 * 864e5 }; });
  const SC = { Passed: '--filled', Failed: '--danger', 'In progress': '--prog', 'Not started': '--hold', Expired: '--hold' };
  const PC = [['person', 'Name'], ['email', 'Email'], ['sent', 'Link sent', (x) => new Date(x.sent_at).toLocaleDateString('en-GB')], ['exp', 'Expires', (x) => new Date(x.expires_at).toLocaleDateString('en-GB')], ['mod', 'Modules', (x) => `${x.r.modules_watched || 0}/${T.videos.length}`], ['score', 'Score %', (x) => x.r.score ?? ''], ['att', 'Attempts', (x) => x.r.attempts || (x.r.completed_at ? 1 : 0)], ['status', 'Status'], ['rd', 'Refresher due', (x) => x.r.refresher_due || '']];
  const kk = (l, v, sub, c, key, list) => `<div class="card kpi click" style="--c:var(${c})" ${dset(key, l, list, PC)}><span>${l}</span><b>${v}</b><small>${sub}</small></div>`;
  const body = $('#sgBody'), passed = rows.filter((x) => x.status === 'Passed');

  if (st.tab === 'overview') {
    const started = rows.filter((x) => (x.r.modules_watched || 0) > 0 || x.r.completed_at), allMods = rows.filter((x) => (x.r.modules_watched || 0) >= T.videos.length), sc = passed.map((x) => x.r.score).filter((x) => x != null);
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px"><section class="grid">
      ${kk('Trained', (rows.length ? Math.round(passed.length / rows.length * 100) : 0) + '%', `${passed.length} of ${rows.length} people`, '--filled', 'sg1', passed)}
      ${kk('In progress', rows.filter((x) => x.status === 'In progress').length, 'watching videos', '--prog', 'sg2', rows.filter((x) => x.status === 'In progress'))}
      ${kk('Not started', rows.filter((x) => x.status === 'Not started').length, 'link sent, not opened', '--hold', 'sg3', rows.filter((x) => x.status === 'Not started'))}
      ${kk('Overdue', rows.filter((x) => x.overdue).length, 'not passed after 3 days', '--danger', 'sg4', rows.filter((x) => x.overdue))}
      ${kk('Failed quiz', rows.filter((x) => x.status === 'Failed').length, 'need another go', '--danger', 'sg5', rows.filter((x) => x.status === 'Failed'))}
      ${kk('Expired links', rows.filter((x) => x.status === 'Expired').length, 'resend or extend', '--hold', 'sg6', rows.filter((x) => x.status === 'Expired'))}
      ${kk('Average score', sc.length ? Math.round(sc.reduce((a, b) => a + b, 0) / sc.length) + '%' : '—', `pass mark ${T.pass_mark}%`, '--acc', 'sg7', passed)}
      ${kk('Refresher due', rows.filter((x) => x.refresh).length, 'in the next 30 days', '--raised', 'sg8', rows.filter((x) => x.refresh))}</section>
      <section class="charts"><div class="card"><h2>Completion funnel</h2><canvas id="sgF"></canvas></div><div class="card"><h2>Passed per month</h2><canvas id="sgM"></canvas></div></section>
      ${T.videos.some((v) => !v.youtube) ? `<div class="card" style="border-left:3px solid var(--danger)"><b>Video links are missing.</b> <span class="muted">People can't start the training until all 5 YouTube links are added in ${manage ? 'the Setup tab' : 'Setup (ask Syed)'}.</span></div>` : ''}</div>`;
    Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border');
    S.charts.push(new Chart($('#sgF'), { type: 'bar', data: { labels: ['Links sent', 'Started', 'All videos watched', 'Passed'], datasets: [{ data: [rows.length, started.length, allMods.length, passed.length], backgroundColor: ['--acc', '--prog', '--offer', '--filled'].map(cssv), borderRadius: 6 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } }));
    const ms = [...Array(6)].map((_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 5 + i); return d.toISOString().slice(0, 7); });
    S.charts.push(new Chart($('#sgM'), { type: 'bar', data: { labels: ms.map((m) => MN[+m.slice(5) - 1]), datasets: [{ label: 'Passed', data: ms.map((m) => passed.filter((x) => (x.r.completed_at || '').startsWith(m)).length), backgroundColor: cssv('--filled'), borderRadius: 5 }, { label: 'Links sent', data: ms.map((m) => rows.filter((x) => (x.sent_at || '').startsWith(m)).length), backgroundColor: cssv('--acc'), borderRadius: 5 }] } }));
    return;
  }

  if (st.tab === 'people') {
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px"><div class="row"><label class="f" style="flex:1;min-width:240px">Search<input id="spQ" value="${esc(st.q)}" placeholder="Name or email"></label><label class="f">Status<select id="spS"><option value="">All</option>${['Passed', 'In progress', 'Not started', 'Failed', 'Expired', 'Overdue', 'Refresher due'].map((x) => `<option ${st.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>${send ? '<button class="btn" id="spRem">Email reminder to all overdue</button>' : ''}</div><div class="tablewrap" id="spW"></div></div>`;
    let list = [];
    const draw = () => { st.q = $('#spQ').value.toLowerCase(); st.status = $('#spS').value;
      list = rows.filter((x) => (!st.q || `${x.person} ${x.email}`.toLowerCase().includes(st.q)) && (!st.status || (st.status === 'Overdue' ? x.overdue : st.status === 'Refresher due' ? x.refresh : x.status === st.status)));
      $('#spW').innerHTML = `<table><thead><tr>${PC.map(([, l]) => `<th>${l}</th>`).join('')}<th></th></tr></thead><tbody>${list.map((x) => `<tr data-t="${x.token}"><td><strong>${esc(x.person)}</strong></td><td>${esc(x.email || '')}</td><td class="mono">${new Date(x.sent_at).toLocaleDateString('en-GB')}</td><td class="mono ${new Date(x.expires_at) < now && x.status !== 'Passed' ? 'err' : ''}">${new Date(x.expires_at).toLocaleDateString('en-GB')}</td>
        <td><div style="display:flex;align-items:center;gap:6px"><div style="width:60px;height:6px;border-radius:99px;background:var(--track)"><div style="height:6px;border-radius:99px;width:${Math.round((x.r.modules_watched || 0) / T.videos.length * 100)}%;background:var(--acc)"></div></div>${x.r.modules_watched || 0}/${T.videos.length}</div></td><td class="mono">${x.r.score ?? ''}</td><td>${x.r.attempts || (x.r.completed_at ? 1 : 0)}</td><td>${chip(x.status, SC)}${x.overdue ? ' <span class="err" style="font-size:11.5px">overdue</span>' : ''}</td><td class="mono">${x.r.refresher_due || ''}</td>
        <td style="white-space:nowrap"><button class="btn sm" data-a="copy" title="Copy link">🔗</button>${send && x.email ? ' <button class="btn sm" data-a="mail" title="Email link">✉️</button>' : ''}${edit ? ' <button class="btn sm" data-a="extend" title="Extend 7 days">+7d</button>' : ''}${edit && x.status === 'Failed' ? ' <button class="btn sm" data-a="reset" title="Let them retry">↺</button>' : ''}${x.status === 'Passed' ? ` <a class="btn sm" target="_blank" rel="noopener" href="${base}?t=${x.token}" title="Certificate">🎓</a>` : ''}</td></tr>`).join('') || `<tr><td colspan="10">${empty('Nobody matches', 'Send training from the "Send training" tab.')}</td></tr>`}</tbody></table>`;
      $$('#spW [data-a]').forEach((b) => (b.onclick = () => act(b.dataset.a, b.closest('tr').dataset.t))); };
    const act = async (a, token) => { const x = rows.find((r) => r.token === token);
      if (a === 'copy') { await navigator.clipboard.writeText(`${base}?t=${token}`); return toast('Link copied.'); }
      if (a === 'mail') return emailModal('training_link', token, () => {});
      if (a === 'extend') { const exp = new Date(Math.max(Date.now(), new Date(x.expires_at)) + 7 * 864e5).toISOString(); const { error } = await sb.from('training_links').update({ expires_at: exp }).eq('token', token); toast(error ? error.message : 'Extended by 7 days.', !!error); if (!error) { x.expires_at = exp; draw(); } }
      if (a === 'reset') { const { error } = await sb.from('training_results').update({ score: null, passed: null, completed_at: null }).eq('token', token); toast(error ? error.message : 'They can retry the quiz now.', !!error); if (!error) pageSafeguarding(); } };
    $('#spQ').oninput = draw; $('#spS').onchange = draw;
    if ($('#spRem')) $('#spRem').onclick = async () => { const od = rows.filter((x) => x.overdue && x.email); if (!od.length) return toast('Nobody overdue has an email address.', true); if (!confirm(`Email the training link again to ${od.length} people?`)) return; let ok = 0; for (const x of od) { try { await callFn('send-email', { template: 'training_link', id: x.token }); ok++; } catch (e) { toast(e.message, true); break; } } toast(`${ok} reminder(s) sent.`); };
    draw(); return;
  }

  if (st.tab === 'send') {
    body.innerHTML = `<div class="charts"><section class="card" style="display:flex;flex-direction:column;gap:12px"><h2>Send training to someone</h2>
      <form id="snF" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px"><label class="f">Full name<input name="person" required></label><label class="f">Email<input name="email" type="email" placeholder="Needed to email the link"></label><label class="f">Link valid for<select name="days"><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
      <div class="row" style="grid-column:1/-1">${edit ? '<button class="btn pri">Create link</button>' : '<span class="soft">You need Edit access to Safeguarding.</span>'}</div></form><div id="snOut"></div></section>
      <section class="card"><h2>How it works</h2><div class="list"><div><span>1. Create the link here, or it's created automatically when a hire or cover email is sent</span></div><div><span>2. They watch 5 videos on their phone (each must finish before the next unlocks)</span></div><div><span>3. Quiz: ${T.questions.length} questions, pass mark ${T.pass_mark}%. They can retry.</span></div><div><span>4. Certificate straight away; refresher due in 12 months</span></div><div><span>5. Overdue after 3 days: reminders from the People tab</span></div></div></section></div>`;
    if ($('#snF') && edit) $('#snF').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
      const { data, error } = await sb.from('training_links').insert({ person: f.person.trim(), email: f.email.trim() || null, expires_at: new Date(Date.now() + +f.days * 864e5).toISOString() }).select('token').single();
      if (error) return toast(error.message, true); const url = `${base}?t=${data.token}`;
      $('#snOut').innerHTML = `<div class="card" style="background:var(--panel2);display:flex;flex-direction:column;gap:8px"><b>Link ready for ${esc(f.person)}</b><code style="word-break:break-all">${esc(url)}</code><div class="row"><button class="btn" id="snC">Copy link</button>${send && f.email ? '<button class="btn pri" id="snM">Email it</button>' : ''}<a class="btn" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent('Hi ' + f.person.split(' ')[0] + ', please complete your Crystal FM safeguarding training before your first shift: ' + url)}">WhatsApp</a></div></div>`;
      $('#snC').onclick = async () => { await navigator.clipboard.writeText(url); toast('Copied.'); }; if ($('#snM')) $('#snM').onclick = () => emailModal('training_link', data.token, () => toast('Sent.')); e.target.reset(); };
    return;
  }

  if (st.tab === 'quiz') {
    const done = res.filter((r) => Array.isArray(r.answers) && r.answers.length);
    const stats = T.questions.map((q, i) => { const n = done.filter((r) => r.answers[i] != null), ok = n.filter((r) => +r.answers[i] === q.answer).length; const wrong = {}; n.forEach((r) => { if (+r.answers[i] !== q.answer) wrong[r.answers[i]] = (wrong[r.answers[i]] || 0) + 1; }); const top = Object.entries(wrong).sort((a, b) => b[1] - a[1])[0];
      return { i, q: q.q, n: n.length, pct: n.length ? Math.round(ok / n.length * 100) : null, wrong: top ? `${q.options[+top[0]] || '?'} (${top[1]})` : '' }; });
    body.innerHTML = done.length ? `<div style="display:flex;flex-direction:column;gap:14px"><p class="muted" style="margin:0">${done.length} quiz attempts analysed. Questions people get wrong most often are at the top; consider covering them better in the induction.</p>
      <div class="tablewrap"><table><thead><tr><th>#</th><th>Question</th><th>Answered</th><th>% correct</th><th>Most common wrong answer</th></tr></thead><tbody>${stats.sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101)).map((x) => `<tr><td>${x.i + 1}</td><td>${esc(x.q)}</td><td>${x.n}</td><td><span class="chip" style="--c:var(${x.pct == null ? '--hold' : x.pct < 60 ? '--danger' : x.pct < 85 ? '--prog' : '--filled'})">${x.pct ?? '—'}${x.pct != null ? '%' : ''}</span></td><td class="soft">${esc(x.wrong)}</td></tr>`).join('')}</tbody></table></div></div>`
      : `<div class="card">${empty('No quiz attempts recorded yet', 'Answers are saved from now on (after phase14 SQL and the new training function).')}</div>`;
    return;
  }

  if (st.tab === 'setup' && manage) {
    let Q = JSON.parse(JSON.stringify(T.questions));
    const qHtml = () => Q.map((q, i) => `<div class="card" style="padding:12px;display:flex;flex-direction:column;gap:6px" data-qi="${i}"><div class="row" style="align-items:center"><b style="flex:none">Q${i + 1}</b><input data-k="q" value="${esc(q.q)}" style="flex:1" aria-label="Question ${i + 1}"><button type="button" class="btn sm" data-del title="Remove">✕</button></div>
      ${q.options.map((o, j) => `<label style="display:flex;gap:8px;align-items:center"><input type="radio" name="ans${i}" data-ans="${j}" ${q.answer === j ? 'checked' : ''} aria-label="Correct answer"><input data-opt="${j}" value="${esc(o)}" style="flex:1" aria-label="Option ${j + 1}"></label>`).join('')}</div>`).join('');
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:14px"><section class="card" style="display:flex;flex-direction:column;gap:10px"><h2>Videos (unlisted YouTube links)</h2>${T.videos.map((v, i) => `<label class="f">${esc(v.title)}<div class="row"><input data-vid="${i}" value="${esc(v.youtube)}" placeholder="https://youtu.be/…" style="flex:1">${v.youtube ? `<a class="btn sm" href="${esc(v.youtube)}" target="_blank" rel="noopener">Test</a>` : '<span class="chip" style="--c:var(--danger)">missing</span>'}</div></label>`).join('')}
      <div class="row"><label class="f">Pass mark %<input id="suP" type="number" min="50" max="100" value="${T.pass_mark}" style="width:110px"></label><label class="f">Course title<input id="suT" value="${esc(T.title || '')}" style="min-width:300px"></label></div></section>
      <section class="card" style="display:flex;flex-direction:column;gap:10px"><h2>Quiz questions <span class="soft" style="font-weight:500;font-size:12px;margin-left:auto">tick the correct answer</span></h2><div id="suQ" style="display:flex;flex-direction:column;gap:10px">${qHtml()}</div><button type="button" class="btn" id="suAdd">＋ Add question</button></section>
      <div class="row"><button class="btn pri" id="suSave">Save training setup</button><a class="btn" href="${base}?t=preview" target="_blank" rel="noopener">Open training page</a></div></div>`;
    const sync = () => $$('#suQ [data-qi]').forEach((card) => { const i = +card.dataset.qi; Q[i].q = $('[data-k=q]', card).value; Q[i].options = $$('[data-opt]', card).map((o) => o.value); const a = $('[data-ans]:checked', card); Q[i].answer = a ? +a.dataset.ans : 0; });
    const rebind = () => $$('#suQ [data-del]').forEach((b) => (b.onclick = () => { sync(); Q.splice(+b.closest('[data-qi]').dataset.qi, 1); $('#suQ').innerHTML = qHtml(); rebind(); }));
    rebind();
    $('#suAdd').onclick = () => { sync(); Q.push({ q: '', options: ['', '', '', ''], answer: 0 }); $('#suQ').innerHTML = qHtml(); rebind(); };
    $('#suSave').onclick = async () => { sync(); if (Q.some((q) => !q.q.trim() || q.options.some((o) => !o.trim()))) return toast('Fill in every question and all 4 answers.', true);
      const value = { ...T, title: $('#suT').value, pass_mark: +$('#suP').value, videos: T.videos.map((v, i) => ({ ...v, youtube: $(`[data-vid="${i}"]`).value.trim() })), questions: Q };
      const { error } = await sb.from('settings').upsert({ key: 'training', value }); if (error) return toast(error.message, true); S.settings.training = value; toast('Training setup saved.'); };
    return;
  }
}

/* ---------- finance & P&L ---------- */
const money = (n) => (n < 0 ? '-£' : '£') + Math.abs(Math.round(n || 0)).toLocaleString('en-GB');
const normName = (x) => String(x || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/&/g, 'and').replace(/\b(ltd|limited|the|school|academy|plc)\b/g, '').replace(/[^a-z0-9]/g, '');
function plCalc(e, k) {
  const rev = +e.revenue || 0, lab = +e.labour_cost || 0, oth = (+e.materials || 0) + (+e.other_costs || 0), margin = rev - lab - oth;
  const pctv = rev ? Math.round(margin / rev * 1000) / 10 : (margin < 0 ? -100 : 0);
  const flags = [];
  if (margin < 0) flags.push(['Loss', '--danger']);
  else if (k && pctv < (+k.target_margin_pct || 15)) flags.push(['Low margin', '--prog']);
  const yrs = k?.start_date ? (new Date(e.month) - new Date(k.start_date)) / (365.25 * 864e5) : 0;
  const rate = e.invoiced_hours ? rev / e.invoiced_hours : null;
  if (yrs >= 1 && ((k.monthly_value_y2 && rev < k.monthly_value_y2 * 0.98) || (k.year2_rate && rate && rate < k.year2_rate * 0.98))) flags.push(['Year 1 price in Year 2?', '--raised']);
  else if (yrs < 1 && k?.monthly_value && rev < k.monthly_value * 0.98) flags.push(['Under-invoiced', '--raised']);
  return { rev, lab, oth, margin, pct: pctv, rate, flags, gap: yrs >= 1 && k?.monthly_value_y2 ? Math.max(0, k.monthly_value_y2 - rev) : k?.monthly_value ? Math.max(0, k.monthly_value - rev) : 0 };
}
async function pageFinance() {
  const edit = can('finance', 'edit'), send = canFlag('finance', 'can_send_email');
  const st = (S.fin ||= { tab: 'month', month: '', am: '', q: '', only: '' });
  shell(`<div class="head"><div><div class="soft">Finance</div><h1>Contract P&amp;L</h1></div><div class="row" id="fFil"></div></div>
    <div class="tabs" role="tablist">${[['month','Monthly P&L'],['trend','Trends'],['import','Import P&L']].map(([k, l]) => `<button role="tab" data-ft="${k}" aria-selected="${st.tab === k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="fBody">${SKEL}</div>`);
  $$('[data-ft]').forEach((b) => (b.onclick = () => { st.tab = b.dataset.ft; pageFinance(); }));
  const [K, E, A] = await Promise.all([fetchAll('contracts', 'id,name,ref,area_manager,region,start_date,monthly_value,monthly_value_y2,year1_rate,year2_rate,target_margin_pct', (q) => q.order('name')), fetchAll('pl_entries', '*'), sb.from('loss_alerts').select('contract_id,month,sent_at').then((r) => r.data || [])]);
  if (!$('#fBody')) return;
  const KM = new Map(K.map((k) => [k.id, k]));
  const months = [...new Set(E.map((e) => e.month.slice(0, 7)))].sort().reverse();
  if (!st.month) st.month = months[0] || new Date().toISOString().slice(0, 7);
  const ams = [...new Set(K.map((k) => k.area_manager).filter(Boolean))].sort();
  $('#fFil').innerHTML = `${st.tab !== 'import' ? `<label class="f">Month<input type="month" id="fM" value="${st.month}"></label><label class="f">Area Manager<select id="fA"><option value="">All</option>${ams.map((a) => `<option ${st.am === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label><label class="f">Show<select id="fO"><option value="">All contracts</option><option value="Loss" ${st.only === 'Loss' ? 'selected' : ''}>Loss-making</option><option value="price" ${st.only === 'price' ? 'selected' : ''}>Pricing flags</option><option value="missing" ${st.only === 'missing' ? 'selected' : ''}>No P&amp;L data</option></select></label><label class="f">Search<input id="fQ" value="${esc(st.q)}" placeholder="Contract"></label>${reportBar('fR')}` : ''}`;
  if ($('#fM')) { $('#fM').onchange = (e) => { st.month = e.target.value; pageFinance(); }; $('#fA').onchange = (e) => { st.am = e.target.value; pageFinance(); }; $('#fO').onchange = (e) => { st.only = e.target.value; pageFinance(); }; $('#fQ').onchange = (e) => { st.q = e.target.value; pageFinance(); }; }
  const kOk = (k) => k && (!st.am || k.area_manager === st.am) && (!st.q || k.name.toLowerCase().includes(st.q.toLowerCase()));
  if (st.tab === 'import') return finImport(K);
  const cur = E.filter((e) => e.month.startsWith(st.month) && kOk(KM.get(e.contract_id))).map((e) => ({ e, k: KM.get(e.contract_id), c: plCalc(e, KM.get(e.contract_id)) }));
  const missing = K.filter((k) => kOk(k) && !cur.some((r) => r.k.id === k.id));
  const T = cur.reduce((t, r) => ({ rev: t.rev + r.c.rev, cost: t.cost + r.c.lab + r.c.oth, margin: t.margin + r.c.margin }), { rev: 0, cost: 0, margin: 0 });
  const losses = cur.filter((r) => r.c.margin < 0), priceFlags = cur.filter((r) => r.c.flags.some(([f]) => /price|Under/.test(f)));
  const FC = [['contract', 'Contract', (r) => r.k.name], ['am', 'Area Manager', (r) => r.k.area_manager || ''], ['rev', 'Revenue £', (r) => Math.round(r.c.rev)], ['lab', 'Labour £', (r) => Math.round(r.c.lab)], ['oth', 'Materials + other £', (r) => Math.round(r.c.oth)], ['m', 'Margin £', (r) => Math.round(r.c.margin)], ['p', 'Margin %', (r) => r.c.pct], ['f', 'Flags', (r) => r.c.flags.map((f) => f[0]).join(', ')]];
  const kp = (l, v, sub, c, d) => `<div class="card kpi${d ? ' click' : ''}" style="--c:var(${c})" ${d ? dset('fk' + l.replace(/\W/g, ''), `${l} · ${st.month}`, d[0], d[1]) : ''}><span>${l}</span><b>${v}</b><small>${sub}</small></div>`;
  const head = `<section class="grid">${kp('Revenue', money(T.rev), `${cur.length} contracts with data`, '--acc', [cur, FC])}${kp('Costs', money(T.cost), 'labour, materials, other', '--planned')}${kp('Margin', money(T.margin), (T.rev ? Math.round(T.margin / T.rev * 1000) / 10 : 0) + '% of revenue', T.margin < 0 ? '--danger' : '--filled')}${kp('Loss-making', losses.length, money(losses.reduce((s, r) => s + r.c.margin, 0)) + ' lost', '--danger', [losses, FC])}${kp('Pricing flags', priceFlags.length, money(priceFlags.reduce((s, r) => s + r.c.gap, 0)) + ' possibly under-billed', '--raised', [priceFlags, [...FC, ['gap', 'Possible gap £', (r) => Math.round(r.c.gap)]]])}${kp('No P&L data', missing.length, 'contracts missing this month', '--hold', [missing, [['name', 'Contract'], ['area_manager', 'Area Manager'], ['region', 'Region']]])}</section>`;
  if ($('#fRX')) $('#fRX').onclick = () => downloadReport(`Crystal FM P&L ${st.month}`, [{ Measure: 'Revenue', Value: Math.round(T.rev) }, { Measure: 'Costs', Value: Math.round(T.cost) }, { Measure: 'Margin', Value: Math.round(T.margin) }, { Measure: 'Loss-making contracts', Value: losses.length }, { Measure: 'Pricing flags', Value: priceFlags.length }, { Measure: 'No P&L data', Value: missing.length }]);
  if (st.tab === 'trend') return finTrend(head, E, KM, kOk);
  let rows = cur;
  if (st.only === 'Loss') rows = losses; else if (st.only === 'price') rows = priceFlags;
  rows.sort((a, b) => a.c.margin - b.c.margin);
  const lastAlert = (r) => A.filter((a) => a.contract_id === r.k.id && a.month === r.e.month).sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0];
  const inp = (r, f) => edit ? `<input data-f="${f}" value="${esc(r.e[f] ?? '')}" style="min-width:90px;text-align:right" aria-label="${f}">` : esc(r.e[f] ?? '');
  $('#fBody').innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">${head}
    <section class="charts"><div class="card"><h2>Biggest losses</h2><canvas id="fLoss"></canvas></div><div class="card"><h2>Margin by Area Manager</h2><canvas id="fAm"></canvas></div></section>
    ${send && losses.length ? `<div class="row"><button class="btn pri" id="fMailAll">Email all ${losses.length} loss-making Area Managers</button><span class="soft">Each AM gets their contract's figures and is asked for an action plan within 5 days.</span></div>` : ''}
    ${st.only === 'missing' ? `<div class="card"><h2>No P&amp;L data for ${esc(st.month)}</h2><div class="list">${missing.map((k) => `<div><span>${esc(k.name)}</span><b>${esc(k.area_manager || '')}</b></div>`).join('')}</div></div>` : `
    <div class="tablewrap"><table><thead><tr><th>Contract</th><th>Area Manager</th><th>Revenue</th><th>Inv. hours</th><th>Labour</th><th>Lab. hours</th><th>Materials</th><th>Other</th><th>Margin</th><th>%</th><th>£/hr billed</th><th>Flags</th><th></th></tr></thead><tbody>
    ${rows.map((r) => { const la = lastAlert(r); return `<tr data-id="${r.e.id}"><td><strong>${esc(r.k.name)}</strong></td><td>${esc(r.k.area_manager || '')}</td><td>${inp(r, 'revenue')}</td><td>${inp(r, 'invoiced_hours')}</td><td>${inp(r, 'labour_cost')}</td><td>${inp(r, 'labour_hours')}</td><td>${inp(r, 'materials')}</td><td>${inp(r, 'other_costs')}</td>
      <td class="mono" style="color:var(${r.c.margin < 0 ? '--danger' : '--filled'});font-weight:700">${money(r.c.margin)}</td><td class="mono">${r.c.pct}%</td><td class="mono">${r.c.rate ? '£' + r.c.rate.toFixed(2) : '—'}${r.k.year2_rate || r.k.year1_rate ? `<br><span class="soft">contract £${(+(r.k.year2_rate || r.k.year1_rate)).toFixed(2)}</span>` : ''}</td>
      <td>${r.c.flags.map(([f, c]) => `<span class="chip" style="--c:var(${c})">${f}</span>`).join(' ') || '<span class="soft">OK</span>'}</td>
      <td style="white-space:nowrap">${send && r.c.margin < 0 ? `<button class="btn sm" data-ma="${r.e.id}">Email AM</button>` : ''}${la ? `<br><span class="soft">alert sent ${new Date(la.sent_at).toLocaleDateString('en-GB')}</span>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="13" class="muted" style="padding:20px">No P&amp;L data for this month. Use the Import P&amp;L tab.</td></tr>'}</tbody></table></div>`}</div>`;
  if (edit) bindEdits('pl_entries', $('#fBody'), () => {});
  $$('[data-ma]').forEach((b) => (b.onclick = () => emailModal('loss_alert', b.dataset.ma, () => pageFinance())));
  if ($('#fMailAll')) $('#fMailAll').onclick = async () => { if (!confirm(`Send ${losses.length} loss alerts now?`)) return; let ok = 0, fail = []; for (const r of losses) { try { await callFn('send-email', { template: 'loss_alert', id: r.e.id }); ok++; } catch (e) { fail.push(`${r.k.name}: ${e.message}`); } } toast(`${ok} sent${fail.length ? `, ${fail.length} failed (${fail[0]})` : ''}.`, !!fail.length); pageFinance(); };
  Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border');
  if ($('#fLoss')) {
    const lz = losses.slice(0, 10);
    S.charts.push(new Chart($('#fLoss'), { type: 'bar', data: { labels: lz.map((r) => r.k.name.slice(0, 26)), datasets: [{ data: lz.map((r) => Math.round(r.c.margin)), backgroundColor: cssv('--danger'), borderRadius: 6 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } }));
    const byAm = {}; cur.forEach((r) => { const a = r.k.area_manager || 'Not assigned'; (byAm[a] ||= { rev: 0, m: 0 }); byAm[a].rev += r.c.rev; byAm[a].m += r.c.margin; });
    const am = Object.entries(byAm).sort((a, b) => a[1].m - b[1].m);
    S.charts.push(new Chart($('#fAm'), { type: 'bar', data: { labels: am.map((x) => x[0]), datasets: [{ label: 'Margin £', data: am.map((x) => Math.round(x[1].m)), backgroundColor: am.map((x) => cssv(x[1].m < 0 ? '--danger' : '--filled')), borderRadius: 6 }] }, options: { plugins: { legend: { display: false } } } }));
  }
}
function finTrend(head, E, KM, kOk) {
  const ms = [...new Set(E.map((e) => e.month.slice(0, 7)))].sort().slice(-12);
  const by = ms.map((m) => E.filter((e) => e.month.startsWith(m) && kOk(KM.get(e.contract_id))).map((e) => plCalc(e, KM.get(e.contract_id))));
  const rev = by.map((a) => Math.round(a.reduce((s, c) => s + c.rev, 0))), cost = by.map((a) => Math.round(a.reduce((s, c) => s + c.lab + c.oth, 0)));
  const pctv = rev.map((r, i) => (r ? Math.round((r - cost[i]) / r * 1000) / 10 : 0)), lossN = by.map((a) => a.filter((c) => c.margin < 0).length);
  // contracts losing money 3+ months in a row
  const streak = [...KM.values()].filter(kOk).map((k) => { let n = 0; for (let i = ms.length - 1; i >= 0; i--) { const e = E.find((x) => x.contract_id === k.id && x.month.startsWith(ms[i])); if (e && plCalc(e, k).margin < 0) n++; else break; } return [k.name, n]; }).filter((x) => x[1] >= 2).sort((a, b) => b[1] - a[1]);
  $('#fBody').innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">${head}<section class="charts"><div class="card wide"><h2>Revenue, costs and margin · last 12 months</h2><canvas id="ftA" height="80"></canvas></div><div class="card"><h2>Loss-making contracts per month</h2><canvas id="ftB"></canvas></div>
    <div class="card"><h2>Losing money month after month</h2><p class="soft" style="margin:0 0 6px">Consecutive loss months up to the latest month</p><div class="list">${streak.map(([n, c]) => `<div><span>${esc(n)}</span><b>${c} months</b></div>`).join('') || '<p class="muted">None. 👏</p>'}</div></div></section></div>`;
  Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border');
  S.charts.push(new Chart($('#ftA'), { data: { labels: ms.map((m) => MN[+m.slice(5) - 1] + ' ' + m.slice(2, 4)), datasets: [{ type: 'bar', label: 'Revenue', data: rev, backgroundColor: cssv('--acc'), borderRadius: 4, yAxisID: 'y' }, { type: 'bar', label: 'Costs', data: cost, backgroundColor: cssv('--unplanned'), borderRadius: 4, yAxisID: 'y' }, { type: 'line', label: 'Margin %', data: pctv, borderColor: cssv('--text'), yAxisID: 'y2' }] }, options: { scales: { y: { beginAtZero: true }, y2: { position: 'right', grid: { display: false } } } } }));
  S.charts.push(new Chart($('#ftB'), { type: 'bar', data: { labels: ms.map((m) => MN[+m.slice(5) - 1]), datasets: [{ data: lossN, backgroundColor: cssv('--danger'), borderRadius: 6 }] }, options: { plugins: { legend: { display: false } } } }));
}
function finImport(K) {
  const FIELDS = [['contract', 'Contract name', true], ['month', 'Month', false], ['revenue', 'Revenue (invoiced)', true], ['invoiced_hours', 'Invoiced hours', false], ['labour_cost', 'Labour cost', true], ['labour_hours', 'Labour hours', false], ['materials', 'Materials', false], ['other_costs', 'Other costs', false]];
  const guess = { contract: /contract|site|client|customer|project/i, month: /month|period|date/i, revenue: /revenue|income|sales|invoic(ed|e) ?(value|amount|£)?$/i, invoiced_hours: /invoic.*hour|billed.*hour/i, labour_cost: /labou?r|wage|payroll|salar/i, labour_hours: /labou?r.*hour|worked.*hour|paid.*hour/i, materials: /material|consum|chemical|suppl/i, other_costs: /other|equip|van|overhead|misc/i };
  $('#fBody').innerHTML = `<section class="card" style="gap:12px"><h2>Import P&amp;L from Excel or CSV</h2>
    <p class="muted" style="margin:0">One row per contract per month. Column names don't need to match; you pick them below. Existing figures for the same contract and month are replaced.</p>
    <div class="row"><input type="file" id="fiF" accept=".xlsx,.xls,.csv"><button class="btn" id="fiT">Download blank template</button><label class="f">If the file has no Month column, use<input type="month" id="fiM" value="${S.fin.month}"></label></div>
    <div id="fiMap"></div><div id="fiPrev"></div></section>`;
  $('#fiT').onclick = () => downloadCsv('pl-template.csv', [{ contract: K[0]?.name || 'Contract name', month: S.fin.month, revenue: 0, invoiced_hours: 0, labour_cost: 0, labour_hours: 0, materials: 0, other_costs: 0 }]);
  let WB = null;
  const loadSheet = () => {
    const ws = WB.Sheets[$('#fiS').value];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false });
    const hr = Math.max(0, (+$('#fiH').value || 1) - 1);
    const hdr = (grid[hr] || []).map((h, i) => String(h).trim() || `Column ${i + 1}`);
    return { cols: hdr, data: grid.slice(hr + 1).filter((r) => r.some((c) => String(c).trim() !== '')).map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i] ?? '']))) };
  };
  const guessHeader = (ws) => { const g = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }).slice(0, 25); let best = 0, score = -1; g.forEach((r, i) => { const t = r.filter((c) => typeof c === 'string' && c.trim() && isNaN(+c)).length; if (t > score) { score = t; best = i; } }); return best + 1; };
  $('#fiF').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { WB = XLSX.read(await f.arrayBuffer(), { cellDates: true }); } catch (er) { return toast("Couldn't read that file: " + er.message, true); }
    const CP = parseCrystalPL(WB); if (CP && CP.projects.length) { $('#fiPrev').innerHTML = ''; return crystalImport(CP, K); }
    $('#fiMap').innerHTML = `<div class="row"><label class="f">Sheet<select id="fiS">${WB.SheetNames.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label><label class="f">Header row number<input type="number" id="fiH" min="1" value="${guessHeader(WB.Sheets[WB.SheetNames[0]])}" style="width:110px"></label><button class="btn" id="fiReload">Use this sheet</button></div><div id="fiCols"></div>`;
    $('#fiS').onchange = () => { $('#fiH').value = guessHeader(WB.Sheets[$('#fiS').value]); showCols(); };
    $('#fiReload').onclick = showCols; $('#fiH').onchange = showCols; showCols();
  };
  const showCols = () => {
    let cols, data;
    try { ({ cols, data } = loadSheet()); } catch (er) { return toast("Couldn't read that sheet: " + er.message, true); }
    if (!data.length) { $('#fiCols').innerHTML = '<p class="err">No rows under that header row. Try another header row number or sheet.</p>'; return; }
    $('#fiCols').innerHTML = `<p class="soft" style="margin:10px 0 6px">${data.length} rows found. First row: ${esc(Object.values(data[0]).slice(0, 6).join(' | '))}</p><div class="row">${FIELDS.map(([k, l, req]) => { const pick = cols.find((c) => guess[k].test(c)); return `<label class="f">${l}${req ? ' *' : ''}<select data-map="${k}"><option value="">—</option>${cols.map((c) => `<option ${c === pick ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>`; }).join('')}</div><button class="btn pri" id="fiGo" style="margin-top:10px">Check rows</button>`;
    bindGo(data);
  };
  const bindGo = (data) => {
    $('#fiGo').onclick = () => {
      const M = Object.fromEntries($$('[data-map]').map((s) => [s.dataset.map, s.value]));
      if (!M.contract || !M.revenue || !M.labour_cost) return toast('Pick at least Contract, Revenue and Labour cost.', true);
      const byName = new Map(K.map((k) => [normName(k.name), k])), byRef = new Map(K.filter((k) => k.ref).map((k) => [String(k.ref), k]));
      const num = (v) => { const n = parseFloat(String(v).replace(/[£,\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return isNaN(n) ? null : n; };
      const monthOf = (v) => { if (!v) return $('#fiM').value; if (typeof v === 'number' && v > 30000) v = new Date(Math.round((v - 25569) * 864e5)); if (v instanceof Date) return new Date(v.getTime() + 12 * 36e5).toISOString().slice(0, 7); const d = new Date(v); return isNaN(d) ? $('#fiM').value : d.toISOString().slice(0, 7); };
      const out = data.map((r) => { const name = String(r[M.contract]).trim(); const n = normName(name); const k = byRef.get(name) || byName.get(n) || K.find((x) => normName(x.name).includes(n) || n.includes(normName(x.name))) ; return { name, k, row: k && { contract_id: k.id, month: monthOf(M.month && r[M.month]) + '-01', revenue: num(r[M.revenue]) || 0, invoiced_hours: M.invoiced_hours ? num(r[M.invoiced_hours]) : null, labour_cost: num(r[M.labour_cost]) || 0, labour_hours: M.labour_hours ? num(r[M.labour_hours]) : null, materials: M.materials ? num(r[M.materials]) || 0 : 0, other_costs: M.other_costs ? num(r[M.other_costs]) || 0 : 0, source: 'upload' } }; }).filter((x) => x.name);
      const ok = out.filter((x) => x.k), bad = out.filter((x) => !x.k);
      $('#fiPrev').innerHTML = `<p><strong>${ok.length}</strong> rows matched to contracts${bad.length ? `, <span class="err">${bad.length} not matched</span> (fix the name in your file or in Contracts)` : ''}.</p>
        ${bad.length ? `<div class="list" style="max-height:160px;overflow:auto">${bad.map((b) => `<div><span>${esc(b.name)}</span><b>not found</b></div>`).join('')}</div>` : ''}
        <div class="tablewrap" style="max-height:320px;overflow:auto"><table><thead><tr><th>In file</th><th>Matched contract</th><th>Month</th><th>Revenue</th><th>Labour</th><th>Margin</th></tr></thead><tbody>${ok.slice(0, 200).map((x) => { const c = plCalc(x.row, x.k); return `<tr><td>${esc(x.name)}</td><td>${esc(x.k.name)}</td><td>${x.row.month.slice(0, 7)}</td><td class="mono">${money(c.rev)}</td><td class="mono">${money(c.lab)}</td><td class="mono" style="color:var(${c.margin < 0 ? '--danger' : '--filled'})">${money(c.margin)}</td></tr>`; }).join('')}</tbody></table></div>
        ${ok.length && can('finance', 'edit') ? `<button class="btn pri" id="fiSave" style="margin-top:10px">Import ${ok.length} rows</button>` : ''}`;
      if ($('#fiSave')) $('#fiSave').onclick = async () => {
        const rows = Object.values(Object.fromEntries(ok.map((x) => [x.row.contract_id + x.row.month, x.row])));
        for (let i = 0; i < rows.length; i += 200) { const { error } = await sb.from('pl_entries').upsert(rows.slice(i, i + 200), { onConflict: 'contract_id,month' }); if (error) return toast('Import stopped: ' + error.message + (/relation|does not exist/.test(error.message) ? ' (run phase6-finance-map.sql first)' : ''), true); }
        toast(`${rows.length} P&L rows imported.`); S.fin.tab = 'month'; S.fin.month = rows[0].month.slice(0, 7); pageFinance();
      };
    };
  };
}

/* ---------- Crystal P&L workbook (Xero "Project Comparison" sheet) ---------- */
const dice = (a, b) => { a = normName(a); b = normName(b); if (!a || !b) return 0; if (a === b) return 1; const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; }; const A = bg(a), B = bg(b); let n = 0; A.forEach((v, k) => (n += Math.min(v, B.get(k) || 0))); return (2 * n) / (a.length + b.length - 2 || 1); };
function parseCrystalPL(wb) {
  const name = wb.SheetNames.find((n) => /project comparison/i.test(n)); if (!name) return null;
  const g = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true });
  const h = g.findIndex((r) => r && r[0] === 'Entity'); if (h < 1) return null;
  const top = g[h - 1], hdr = g[h]; const blocks = {}; let cur = null;
  hdr.forEach((lab, i) => { const t = top[i]; if (t != null) cur = t; if (!(cur instanceof Date) && !(typeof cur === 'number' && cur > 40000)) return; const d = cur instanceof Date ? cur : new Date(Math.round((cur - 25569) * 864e5)); const m = new Date(d.getTime() + 12 * 36e5).toISOString().slice(0, 7); (blocks[m] ||= {})[String(lab).trim()] = i; });
  const months = Object.keys(blocks).sort();
  const n = (v) => (typeof v === 'number' ? v : parseFloat(v) || 0), r2 = (v) => Math.round(v * 100) / 100;
  const projects = g.slice(h + 1).filter((r) => r && r[0] && r[2] === 'Project' && !/^total/i.test(r[0])).map((r) => ({
    name: String(r[0]).trim(), category: r[1] || null,
    rows: months.map((m) => { const b = blocks[m], v = (k) => (b[k] != null ? n(r[b[k]]) : 0);
      const payroll = v('Payroll'), nonNi = v('Non-NI'), ni = v('Employer NI'), pen = v('Pension');
      const other = v('Cust. rebate') + v('Travel') + v('Subcontractor') + v('Agency') + v('Periodic') + v('DBS');
      return { month: m + '-01', revenue: r2(v('Total Rev')), sales_a: r2(v('Sales A')), sales_d: r2(v('Sales D')), rebate: r2(v('Cust. rebate')), materials: r2(v('Materials')), travel: r2(v('Travel')), subcontractor: r2(v('Subcontractor')), agency: r2(v('Agency')), periodic: r2(v('Periodic')), payroll: r2(payroll), non_ni: r2(nonNi), employer_ni: r2(ni), pension: r2(pen), dbs: r2(v('DBS')), labour_cost: r2(payroll + nonNi + ni + pen), other_costs: r2(other), sheet_net: b['Net Profit'] != null ? n(r[b['Net Profit']]) : null, notes: b.Comments != null ? r[b.Comments] : null };
    }).filter((x) => x.revenue || x.labour_cost || x.materials || x.other_costs),
  })).filter((p) => p.rows.length);
  return { months, projects };
}
async function crystalImport(P, K) {
  const { data: al } = await sb.from('pl_aliases').select('*');
  const A = new Map((al || []).map((a) => [a.project_name, a]));
  const opts = (sel) => `<option value="">— choose —</option><option value="__new" ${sel === '__new' ? 'selected' : ''}>➕ Create as new contract</option><option value="__skip" ${sel === '__skip' ? 'selected' : ''}>Skip (not a client contract)</option>${K.map((k) => `<option value="${k.id}" ${sel === k.id ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}`;
  const rows = P.projects.map((p) => {
    const a = A.get(p.name); if (a) return { p, sel: a.skip ? '__skip' : a.contract_id, how: 'saved' };
    const sc = (a, b) => { const x = normName(a), y = normName(b); if (x.length > 5 && y.length > 5 && (x.includes(y) || y.includes(x))) return 0.9; return dice(a, b); };
    const cands = [...K.map((k) => [k, sc(p.name, k.name), '']), ...S.sites.filter((s2) => s2.contract_id).map((s2) => [K.find((k) => k.id === s2.contract_id), sc(p.name, s2.name) - 0.02, ` via site ${s2.name}`]).filter((x) => x[0])];
    const best = cands.sort((x, y) => y[1] - x[1])[0];
    const skip = /head office|^cfm ho\b|commission|crystal head/i.test(p.name);
    return { p, sel: skip ? '__skip' : best && best[1] >= 0.72 ? best[0].id : '', how: skip ? 'auto-skip' : best && best[1] >= 0.72 ? `auto ${Math.round(best[1] * 100)}%${best[2]}` : best ? `best guess: ${best[0].name} (${Math.round(best[1] * 100)}%)` : '' };
  });
  const todo = rows.filter((r) => !r.sel).length;
  const tot = (m) => P.projects.reduce((s, p) => s + (p.rows.find((x) => x.month.startsWith(m))?.revenue || 0), 0);
  $('#fiMap').innerHTML = `<div class="card" style="background:var(--panel2);display:flex;flex-direction:column;gap:10px"><h2>Crystal P&amp;L workbook detected</h2>
    <p class="muted" style="margin:0">${P.projects.length} projects · months ${P.months[0]} to ${P.months.at(-1)} · latest month revenue ${money(tot(P.months.at(-1)))}. Office sub-site rows are rolled into their project, as in the workbook.</p>
    <div class="row"><label class="f">Months to import<select id="cpM"><option value="all">All ${P.months.length} months</option>${P.months.slice().reverse().map((m) => `<option value="${m}">${m} only</option>`).join('')}</select></label>
      <label class="f">Show<select id="cpF"><option value="todo">${todo} need a decision</option><option value="all">All ${rows.length} projects</option></select></label></div>
    <div class="tablewrap" style="max-height:420px"><table><thead><tr><th>Project in P&amp;L</th><th>Category</th><th>Latest revenue</th><th>Latest net</th><th>Portal contract</th><th>How</th></tr></thead><tbody id="cpB"></tbody></table></div>
    <p class="soft" style="margin:0">Your choices are saved, so next month's import matches automatically.</p>
    <div class="row"><button class="btn pri" id="cpGo">Import P&amp;L</button><span class="soft" id="cpN"></span></div></div>`;
  const draw = () => { const f = $('#cpF').value; $('#cpB').innerHTML = rows.map((r, i) => (f === 'all' || !r.sel) ? (() => { const last = r.p.rows.at(-1); return `<tr><td><strong>${esc(r.p.name)}</strong></td><td>${esc(r.p.category || '')}</td><td class="mono">${money(last.revenue)}</td><td class="mono" style="color:var(${(last.sheet_net ?? 0) < 0 ? '--danger' : '--filled'})">${money(last.sheet_net)}</td><td><select data-cp="${i}" style="min-width:260px">${opts(r.sel)}</select></td><td class="soft">${esc(r.how)}</td></tr>`; })() : '').join(''); $$('[data-cp]').forEach((s) => (s.onchange = () => { rows[+s.dataset.cp].sel = s.value; rows[+s.dataset.cp].how = 'chosen'; $('#cpN').textContent = `${rows.filter((r) => !r.sel).length} still need a decision`; })); $('#cpN').textContent = `${rows.filter((r) => !r.sel).length} still need a decision`; };
  $('#cpF').onchange = draw; draw();
  $('#cpGo').onclick = async () => {
    const left = rows.filter((r) => !r.sel); if (left.length && !confirm(`${left.length} projects have no contract chosen and will be skipped. Continue?`)) return;
    const btn = $('#cpGo'); btn.disabled = true; btn.textContent = 'Importing…';
    try {
      for (const r of rows.filter((x) => x.sel === '__new')) {
        const { data, error } = await sb.from('contracts').insert({ name: r.p.name, category: r.p.category, sector: r.p.category }).select('id').single();
        if (error && !/duplicate/i.test(error.message)) throw error;
        r.sel = data?.id || (await sb.from('contracts').select('id').eq('name', r.p.name).single()).data.id;
      }
      const aliases = rows.filter((r) => r.sel).map((r) => ({ project_name: r.p.name, contract_id: r.sel === '__skip' ? null : r.sel, skip: r.sel === '__skip' }));
      for (let i = 0; i < aliases.length; i += 200) { const { error } = await sb.from('pl_aliases').upsert(aliases.slice(i, i + 200)); if (error) throw error; }
      const want = $('#cpM').value, map = new Map();
      rows.filter((r) => r.sel && r.sel !== '__skip').forEach((r) => r.p.rows.filter((x) => want === 'all' || x.month.startsWith(want)).forEach((x) => {
        const key = r.sel + x.month, cur = map.get(key); const { sheet_net, ...rest } = x;
        const row = { ...rest, contract_id: r.sel, project_name: r.p.name, category: r.p.category, source: 'Crystal P&L workbook' };
        if (cur) Object.keys(row).forEach((k) => { if (typeof row[k] === 'number') cur[k] = Math.round(((cur[k] || 0) + row[k]) * 100) / 100; }); else map.set(key, row);
      }));
      const up = [...map.values()];
      for (let i = 0; i < up.length; i += 200) { const { error } = await sb.from('pl_entries').upsert(up.slice(i, i + 200), { onConflict: 'contract_id,month' }); if (error) throw error; }
      toast(`Imported ${up.length} contract-months of P&L.`); S.fin.tab = 'month'; S.fin.month = P.months.at(-1); pageFinance();
    } catch (e) { toast('Import stopped: ' + e.message + (/column|relation/.test(e.message) ? ' (run phase8-pl-detail.sql first)' : ''), true); btn.disabled = false; btn.textContent = 'Import P&L'; }
  };
}

/* ---------- operations hub (your own tool, stored privately) ---------- */
const hubTabs = () => `<div class="tabs" role="tablist">${[['data','Sites map'],['hub','Operations Hub (your tool)']].map(([k, l]) => `<button role="tab" data-hub="${k}" aria-selected="${(S.hubTab || 'data') === k}" class="${(S.hubTab || 'data') === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
const bindHubTabs = () => $$('[data-hub]').forEach((b) => (b.onclick = () => { S.hubTab = b.dataset.hub; pageMap(); }));
async function pageMap() {
  if ((S.hubTab || 'data') === 'data') return pageDataMap();
  shell(`<div class="head"><div><div class="soft">Operations</div><h1>Operations Hub</h1></div><div class="row">${isAdmin() ? '<label class="btn" style="display:inline-flex;align-items:center;cursor:pointer">Upload new version<input type="file" id="hubUp" accept=".html" hidden></label>' : ''}<button class="btn" id="hubTab">Open in new tab</button><button class="btn" id="hubFull">Full screen</button></div></div>
    ${hubTabs()}<div id="hubBox">${SKEL}</div>`);
  bindHubTabs();
  if ($('#hubUp')) $('#hubUp').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const { error } = await sb.storage.from('private-tools').upload('ops-hub.html', f, { upsert: true, contentType: 'text/html' });
    toast(error ? (/bucket not found/i.test(error.message) ? 'Storage not set up yet: run fix-hub-bucket.sql in Supabase, then upload again.' : error.message) : 'Operations Hub updated.', !!error); if (!error) { S.hubHtml = null; pageMap(); }
  };
  if (!S.hubHtml) {
    // 1) your latest uploaded version (if any), 2) the version built into the portal (encrypted; key only for Operations users)
    try { const { data } = await sb.storage.from('private-tools').download('ops-hub.html'); if (data) S.hubHtml = await data.text(); } catch (_) {}
    if (!S.hubHtml) {
      try {
        const [{ data: kr, error: ke }, buf] = await Promise.all([sb.from('hub_keys').select('k').eq('id', 1).single(), fetch('hub.enc?v=20261024d').then((r) => { if (!r.ok) throw new Error('hub.enc missing'); return r.arrayBuffer(); })]);
        if (ke || !kr) throw new Error(ke?.message || 'no key');
        const raw = new Uint8Array(kr.k.match(/../g).map((h) => parseInt(h, 16)));
        const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
        const bytes = new Uint8Array(buf), plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
        S.hubHtml = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      } catch (e) { console.warn('built-in hub', e); }
    }
    if (!$('#hubBox')) return;
    if (!S.hubHtml) { $('#hubBox').innerHTML = `<div class="card">${empty("The Operations Hub couldn't open", isAdmin() ? 'Run phase14-hub-builtin.sql in Supabase (it holds the unlock key), then refresh.' : 'Ask Syed to finish the setup. The Sites map tab works meanwhile.')}</div>`; return; }
  }
  if (S.hubUrl) URL.revokeObjectURL(S.hubUrl); S.hubUrl = URL.createObjectURL(new Blob([S.hubHtml], { type: 'text/html' }));
  const fr = document.createElement('iframe'); fr.className = 'hubframe'; fr.title = 'Crystal FM Operations Hub'; fr.src = S.hubUrl; fr.setAttribute('allow', 'fullscreen; clipboard-write; geolocation');
  $('#hubBox').replaceChildren(fr);
  $('#hubFull').onclick = () => fr.requestFullscreen && fr.requestFullscreen();
  $('#hubTab').onclick = () => window.open(S.hubUrl, '_blank');
}

/* ---------- Sites map v2: Supabase coordinates, clusters, region / RAG colours, site cards ---------- */
const UK_AREA = (pc) => (String(pc || '').toUpperCase().match(/^([A-Z]{1,2})\d/) || [])[1] || '';
const PC_FIND = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const NORTH_AREAS = new Set(['LS','BD','HX','HD','WF','S','DN','HU','YO','HG','NE','SR','DH','TS','DL','M','L','WA','WN','BL','OL','SK','PR','BB','FY','LA','CA','CH','CW','LN']);
const LONDON_AREAS = new Set(['E','EC','N','NW','SE','SW','W','WC']);
function regionOf(site, k) {
  const r = `${k?.region || ''} ${site.region || ''} ${k?.name || ''}`.toLowerCase(), a = UK_AREA(site.postcode || (site.address || '').match(PC_FIND)?.[0]);
  if (/kernow|cornwall/.test(r) || ['TR', 'PL'].includes(a)) return 'Kernow';
  if (/london/.test(r) || LONDON_AREAS.has(a)) return 'London';
  if (/north|yorkshire|humber|lancashire|manchester|liverpool/.test(r) || NORTH_AREAS.has(a)) return 'North';
  return 'Other';
}
const REG_C = { London: '#2F6FE0', North: '#7357D1', Kernow: '#1E9E5A', Other: '#8792A2' };
const RAG_C = { Red: '#D2423A', Amber: '#D8941A', Green: '#1E9E5A', 'No P&L': '#8792A2' };
const TILES = {
  'Light (Esri)': ['https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', 'Tiles &copy; Esri', 16],
  'Streets (Esri)': ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', 'Tiles &copy; Esri', 19],
  'Topo (Esri)': ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', 'Tiles &copy; Esri', 19],
  'Satellite (Esri)': ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', 'Tiles &copy; Esri', 19],
  'Dark (CARTO)': ['https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', '&copy; OpenStreetMap &copy; CARTO', 19],
  'Light (CARTO)': ['https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', '&copy; OpenStreetMap &copy; CARTO', 19],
  'OpenStreetMap': ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', '&copy; OpenStreetMap contributors', 19],
};
const TILE_FALLBACK = { 'Light (Esri)': 'Light (CARTO)', 'Streets (Esri)': 'Light (CARTO)', 'Topo (Esri)': 'Light (CARTO)', 'Satellite (Esri)': 'Light (CARTO)', 'Dark (CARTO)': 'OpenStreetMap', 'Light (CARTO)': 'OpenStreetMap', OpenStreetMap: null };
function mapError(title, detail) {
  return `<div class="card" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:420px;gap:8px"><div style="font-size:34px">⚠️</div><h2 style="border:none;padding:0;margin:0">${esc(title)}</h2><p class="muted" style="max-width:460px;margin:0">${esc(detail)}</p><button class="btn pri" onclick="location.reload()">Try again</button></div>`;
}
async function locateSites(sites, contracts, onProgress) {
  // 1) postcodes.io bulk (main), 2) retired postcodes, 3) Nominatim (backup, address only, max 20, 1 per 1.2 s). Saves to Supabase.
  const KM = new Map(contracts.map((k) => [k.id, k]));
  const pcOf = (s) => { const m = (s.postcode || '').match(PC_FIND) || (s.address || '').match(PC_FIND) || (KM.get(s.contract_id)?.postcode || '').match(PC_FIND); return m ? (m[1] + ' ' + m[2]).toUpperCase() : null; };
  const todo = sites.filter((s) => !s.lat && !(s.geo_failed && Date.now() - new Date(s.geo_failed) < 7 * 864e5));
  const save = (s, lat, lng, src, pc) => sb.from('sites').update({ lat, lng, geo_source: src, postcode: pc || s.postcode || null, geo_failed: null }).eq('id', s.id).then(() => { s.lat = lat; s.lng = lng; s.geo_source = src; });
  let placed = 0, i = 0;
  const withPc = todo.map((s) => ({ s, pc: pcOf(s) })).filter((x) => x.pc);
  for (let c = 0; c < withPc.length; c += 100) {
    const chunk = withPc.slice(c, c + 100); onProgress?.(`Postcodes ${Math.min(c + 100, withPc.length)}/${withPc.length}`);
    try {
      const r = await fetch('https://api.postcodes.io/postcodes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ postcodes: chunk.map((x) => x.pc) }) }).then((x) => x.json());
      await Promise.all((r.result || []).map((res, j) => res?.result ? (placed++, save(chunk[j].s, res.result.latitude, res.result.longitude, 'postcodes.io', chunk[j].pc)) : null));
    } catch (e) { console.warn('postcodes.io failed', e); }
    await new Promise((res) => setTimeout(res, 600));
  }
  for (const x of withPc.filter((x) => !x.s.lat).slice(0, 25)) {
    try { const d = await fetch('https://api.postcodes.io/terminated_postcodes/' + encodeURIComponent(x.pc)).then((r) => (r.ok ? r.json() : null)); if (d?.result?.latitude) { placed++; await save(x.s, d.result.latitude, d.result.longitude, 'retired postcode', x.pc); } } catch (_) {}
  }
  let strikes = 0;
  for (const s of todo.filter((s) => !s.lat && s.address).slice(0, 20)) {
    onProgress?.(`Addresses ${++i}/${Math.min(20, todo.filter((t) => !t.lat && t.address).length)}`);
    try {
      const arr = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=gb&limit=1&email=operations%40crystalservices.uk.com&q=${encodeURIComponent(s.address)}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      strikes = 0;
      if (arr[0]) { placed++; await save(s, +arr[0].lat, +arr[0].lon, 'nominatim', null); } else await sb.from('sites').update({ geo_failed: new Date().toISOString() }).eq('id', s.id);
    } catch (e) { if (++strikes >= 3) break; }
    await new Promise((res) => setTimeout(res, 1200));
  }
  for (const s of todo.filter((s) => !s.lat)) await sb.from('sites').update({ geo_failed: new Date().toISOString() }).eq('id', s.id);
  return placed;
}
async function pageDataMap() {
  const st = (S.map ||= { color: 'region', month: new Date().toISOString().slice(0, 7), region: '', am: '', client: '', rag: '', loss: false, tiles: '' });
  shell(`<div class="head"><div><div class="soft">Operations</div><h1>Sites map</h1><p class="muted" style="margin:2px 0 0" id="mSub">Every site, coloured by region or contract health.</p></div><div class="row">
    <label class="f">Find site<input id="mFind" placeholder="Site name" list="siteList"></label>
    ${can('operations', 'edit') || can('contracts', 'edit') ? '<button class="btn" id="mLoc">Locate sites</button>' : ''}</div></div>
    ${hubTabs()}
    <div class="row" id="mFil"></div>
    <div class="mapgrid"><div class="card mapcard"><div id="map" role="region" aria-label="Map of Crystal FM sites"></div></div><aside class="card mapside"><h2 id="mTitle">Sites</h2><div class="list" id="mList"></div></aside></div>
    <div id="mMissing"></div>${siteList()}`);
  bindHubTabs();
  if (!window.L) { $('.mapgrid').outerHTML = mapError('The map library could not load', 'Leaflet was blocked or your connection dropped. Check your internet or firewall and try again.'); return; }
  const [a, b] = monthBounds(st.month);
  let sites, K, C, H, P, E;
  try {
    [sites, K, C, H, P, E] = await Promise.all([
      fetchAll('sites', '*'), fetchAll('contracts', 'id,name,area_manager,region,postcode,target_margin_pct,start_date,end_date'),
      can('covers') || can('operations') ? fetchAll('covers', 'site_id,kind,cover_cleaner,notes,date_from', (q) => q.gte('date_from', a).lt('date_from', b)) : [],
      can('recruitment') ? fetchAll('hires', 'site_id,status') : [],
      can('finance') ? fetchAll('pl_entries', 'contract_id,month,revenue,labour_cost,materials,other_costs') : [],
      can('brighthr') ? fetchAll('brighthr_employees', 'site_id', (q) => q.eq('terminated', false)).catch(() => []) : []]);
  } catch (e) { if ($('.mapgrid')) $('.mapgrid').outerHTML = mapError("Couldn't load site data", e.message); return; }
  if (!$('#map')) return;
  const KM = new Map(K.map((k) => [k.id, k]));
  const plMonth = [...new Set(P.map((p) => p.month))].sort().pop();
  const PLC = new Map(); P.filter((p) => p.month === plMonth).forEach((p) => { const m = (+p.revenue || 0) - (+p.labour_cost || 0) - (+p.materials || 0) - (+p.other_costs || 0); const x = PLC.get(p.contract_id) || { rev: 0, m: 0 }; x.rev += +p.revenue || 0; x.m += m; PLC.set(p.contract_id, x); });
  const ragOf = (k) => { const x = k && PLC.get(k.id); if (!x) return 'No P&L'; const pct = x.rev ? x.m / x.rev * 100 : (x.m < 0 ? -100 : 0); return x.m < 0 ? 'Red' : pct < (+k.target_margin_pct || 15) ? 'Amber' : 'Green'; };
  const staffBy = new Map(); E.forEach((e) => e.site_id && staffBy.set(e.site_id, (staffBy.get(e.site_id) || 0) + 1));
  const rows = sites.map((s) => { const k = KM.get(s.contract_id), cs = C.filter((c) => c.site_id === s.id); return { ...s, k, region: regionOf(s, k), rag: ragOf(k), pl: k ? PLC.get(k.id) : null, covers: cs.length, missed: cs.filter((c) => coverState(c) === 'missed').length, open: H.filter((h) => h.site_id === s.id && h.status && h.status !== 'Filled').length, staff: staffBy.get(s.id) || 0 }; });
  const ams = [...new Set(K.map((k) => k.area_manager).filter(Boolean))].sort(), clients = [...new Set(rows.map((r) => r.k?.name).filter(Boolean))].sort();
  const sel = (id, label, cur, opts) => `<label class="f">${label}<select id="${id}"><option value="">All</option>${opts.map((o) => `<option ${cur === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
  $('#mFil').innerHTML = `<label class="f">Colour by<select id="fC"><option value="region" ${st.color === 'region' ? 'selected' : ''}>Region</option><option value="rag" ${st.color === 'rag' ? 'selected' : ''}>Contract status (RAG)</option><option value="covers" ${st.color === 'covers' ? 'selected' : ''}>Covers this month</option></select></label>
    ${sel('fR', 'Region', st.region, ['London', 'North', 'Kernow', 'Other'])}${sel('fA', 'Area Manager', st.am, ams)}${sel('fK', 'Client', st.client, clients)}${can('finance') ? sel('fG', 'Status', st.rag, ['Red', 'Amber', 'Green', 'No P&L']) : ''}
    <label class="f">Covers month<input type="month" id="fM" value="${st.month}"></label>${can('finance') ? `<label class="f" style="flex-direction:row;align-items:center;gap:8px;margin-bottom:8px"><input type="checkbox" id="fL" ${st.loss ? 'checked' : ''}> Loss-making only</label>` : ''}`;
  [['fC', 'color'], ['fR', 'region'], ['fA', 'am'], ['fK', 'client'], ['fG', 'rag'], ['fM', 'month']].forEach(([id, k]) => { if ($('#' + id)) $('#' + id).onchange = (e) => { st[k] = e.target.value; pageDataMap(); }; });
  if ($('#fL')) $('#fL').onchange = (e) => { st.loss = e.target.checked; pageDataMap(); };
  const list = rows.filter((r) => (!st.region || r.region === st.region) && (!st.am || r.k?.area_manager === st.am) && (!st.client || r.k?.name === st.client) && (!st.rag || r.rag === st.rag) && (!st.loss || r.rag === 'Red'));
  const located = list.filter((r) => r.lat && r.lng), missing = list.filter((r) => !r.lat || !r.lng);
  // ---- map
  let map;
  try { map = L.map('map', { zoomControl: false, preferCanvas: false }).setView([52.8, -2.2], 6); } catch (e) { $('.mapgrid').outerHTML = mapError('The map could not start', e.message); return; }
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  const dark = document.documentElement.dataset.theme === 'dark';
  let tileName = st.tiles || (dark ? 'Dark (CARTO)' : 'Light (Esri)'), layer = null, errs = 0;
  const setTiles = (name) => { if (layer) map.removeLayer(layer); const [u, att, mz] = TILES[name]; tileName = name; st.tiles = name; errs = 0; layer = L.tileLayer(u, { attribution: att, maxZoom: mz, subdomains: 'abcd', crossOrigin: true });
    layer.on('tileerror', () => { if (++errs === 6 && TILE_FALLBACK[tileName]) { toast(`${tileName} tiles unavailable – switched to ${TILE_FALLBACK[tileName]}.`); setTiles(TILE_FALLBACK[tileName]); } });
    layer.addTo(map); layer.bringToBack(); };
  setTiles(tileName);
  setTimeout(() => { if ($('#map') && !$('#map .leaflet-tile-loaded') && TILE_FALLBACK[tileName]) setTiles(TILE_FALLBACK[tileName]); }, 8000);
  const tileCtl = L.control({ position: 'topright' }); tileCtl.onAdd = () => { const d = L.DomUtil.create('div'); d.innerHTML = `<select aria-label="Map style" style="min-height:32px;box-shadow:var(--shadow)">${Object.keys(TILES).map((n) => `<option ${n === tileName ? 'selected' : ''}>${n}</option>`).join('')}</select>`; L.DomEvent.disableClickPropagation(d); d.querySelector('select').onchange = (e) => setTiles(e.target.value); return d; }; tileCtl.addTo(map);
  const colourOf = (r) => st.color === 'rag' ? RAG_C[r.rag] : st.color === 'covers' ? (r.missed ? '#D2423A' : r.covers ? '#E2762B' : '#8792A2') : REG_C[r.region];
  const pin = (r) => L.divIcon({ className: '', iconSize: [26, 34], iconAnchor: [13, 33], popupAnchor: [0, -28], html: `<svg width="26" height="34" viewBox="0 0 26 34" aria-hidden="true"><path d="M13 1C6.4 1 1 6.3 1 12.8 1 21.6 13 33 13 33s12-11.4 12-20.2C25 6.3 19.6 1 13 1z" fill="${colourOf(r)}" stroke="#fff" stroke-width="2"/><circle cx="13" cy="12.5" r="4.4" fill="#fff"/>${st.color === 'covers' && r.covers ? `<text x="13" y="15.5" text-anchor="middle" font-size="8" font-weight="700" fill="${colourOf(r)}">${r.covers > 9 ? '9+' : r.covers}</text>` : ''}</svg>` });
  const card = (r) => { const pl = r.pl; const pct = pl && pl.rev ? Math.round(pl.m / pl.rev * 1000) / 10 : null;
    return `<div style="min-width:240px;font:13px/1.45 var(--font)"><div style="font-weight:700;font-size:14px">${esc(r.name)}</div><div style="color:#667085;margin-bottom:6px">${esc(r.k?.name || 'No contract')}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><span class="chip" style="--c:${REG_C[r.region]}">${r.region}</span>${can('finance') ? `<span class="chip" style="--c:${RAG_C[r.rag]}">${r.rag}</span>` : ''}</div>
      <table style="width:100%;font-size:12.5px"><tbody>
      <tr><td style="padding:2px 0;color:#667085">Area Manager</td><td style="text-align:right">${esc(r.k?.area_manager || '—')}</td></tr>
      ${can('finance') ? `<tr><td style="padding:2px 0;color:#667085">P&amp;L ${plMonth ? plMonth.slice(0, 7) : ''}</td><td style="text-align:right;font-weight:600;color:${pl ? (pl.m < 0 ? '#D2423A' : '#1E9E5A') : 'inherit'}">${pl ? money(pl.m) + (pct != null ? ` (${pct}%)` : '') : 'no data'}</td></tr>` : ''}
      <tr><td style="padding:2px 0;color:#667085">Staff (BrightHR)</td><td style="text-align:right">${r.staff}</td></tr>
      <tr><td style="padding:2px 0;color:#667085">Covers this month</td><td style="text-align:right">${r.covers}${r.missed ? ` · <b style="color:#D2423A">${r.missed} missed</b>` : ''}</td></tr>
      <tr><td style="padding:2px 0;color:#667085">Open vacancies</td><td style="text-align:right">${r.open}</td></tr>
      <tr><td style="padding:2px 0;color:#667085">Audits</td><td style="text-align:right;color:#98A2B3">coming soon</td></tr></tbody></table>
      <div style="color:#667085;font-size:12px;margin:6px 0 8px">${esc(r.address || '')}</div>
      <div style="display:flex;gap:6px"><a class="btn sm pri" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}">Directions</a><button class="btn sm" data-sitecard="${r.id}">Covers</button><button class="btn sm" data-sitedoc="${r.id}" title="Documents">📄</button><button class="btn sm" data-sitecm="${r.id}" title="Comments">💬</button></div></div>`; };
  const group = L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: (z) => (z >= 12 ? 18 : z >= 10 ? 32 : 46), showCoverageOnHover: false,
    iconCreateFunction: (c) => { const n = c.getChildCount(), sz = n < 10 ? 32 : n < 40 ? 40 : 48; return L.divIcon({ className: '', iconSize: [sz, sz], html: `<div class="mcluster" style="width:${sz}px;height:${sz}px">${n}</div>` }); } }) : L.layerGroup();
  located.forEach((r) => L.marker([r.lat, r.lng], { icon: pin(r), title: r.name, keyboard: true }).bindPopup(card(r), { maxWidth: 320 }).addTo(group));
  group.addTo(map);
  if (!L.markerClusterGroup) toast('Clustering library unavailable – showing all pins without grouping.', true);
  map.on('popupopen', () => { $$('[data-sitecard]').forEach((b2) => (b2.onclick = () => siteDetails(rows.find((x) => String(x.id) === b2.dataset.sitecard), C, H))); $$('[data-sitedoc]').forEach((b2) => (b2.onclick = () => openDocs('site', b2.dataset.sitedoc, rows.find((x) => String(x.id) === b2.dataset.sitedoc)?.name))); $$('[data-sitecm]').forEach((b2) => (b2.onclick = () => openComments('site', b2.dataset.sitecm, rows.find((x) => String(x.id) === b2.dataset.sitecm)?.name))); });
  const fit = () => { if (!$('#map')) return; map.invalidateSize(); if (located.length) map.fitBounds(located.map((r) => [r.lat, r.lng]), { padding: [30, 30], maxZoom: 12 }); };
  fit(); setTimeout(fit, 300); setTimeout(fit, 1000);
  if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe($('#map'));
  const legend = L.control({ position: 'bottomleft' }); legend.onAdd = () => { const d = L.DomUtil.create('div', 'maplegend'); const L2 = st.color === 'rag' ? RAG_C : st.color === 'covers' ? { 'Missed covers': '#D2423A', 'Had covers': '#E2762B', None: '#8792A2' } : REG_C; d.innerHTML = Object.entries(L2).map(([k, c]) => `<span><i style="background:${c}"></i>${k}</span>`).join(''); return d; }; legend.addTo(map);
  // ---- side list + missing list
  const byReg = ['London', 'North', 'Kernow', 'Other'].map((g) => [g, located.filter((r) => r.region === g).length]);
  $('#mSub').textContent = `${located.length} of ${list.length} sites on the map · ${byReg.map(([g, n]) => `${g} ${n}`).join(' · ')}`;
  const ranked = [...list].sort((x, y) => st.color === 'rag' ? ((x.pl?.m ?? 1e9) - (y.pl?.m ?? 1e9)) : (y.covers - x.covers)).slice(0, 60);
  $('#mTitle').textContent = st.color === 'rag' ? 'Worst margins first' : 'Most covers first';
  $('#mList').innerHTML = ranked.map((r) => `<div class="click" data-go="${r.id}"><span><i style="display:inline-block;width:8px;height:8px;border-radius:99px;background:${colourOf(r)};margin-right:6px"></i>${esc(r.name)}<br><span class="soft">${esc(r.k?.area_manager || '')}${r.lat ? '' : ' · not on map'}</span></span><b>${st.color === 'rag' ? (r.pl ? money(r.pl.m) : '—') : r.covers}</b></div>`).join('') || '<p class="muted">No sites match.</p>';
  $$('[data-go]').forEach((d) => (d.onclick = () => { const r = rows.find((x) => String(x.id) === d.dataset.go); if (!r?.lat) return toast('This site has no location yet. Add a postcode below.', true); map.setView([r.lat, r.lng], 15); group.eachLayer((m) => { if (m.options.title === r.name) (group.zoomToShowLayer ? group.zoomToShowLayer(m, () => m.openPopup()) : m.openPopup()); }); }));
  $('#mFind').onchange = (e) => { const r = located.find((x) => x.name.toLowerCase() === e.target.value.toLowerCase()); if (!r) return toast('That site is not on the map yet.', true); $(`[data-go="${r.id}"]`)?.click() || map.setView([r.lat, r.lng], 15); };
  const editable = can('operations', 'edit') || can('contracts', 'edit');
  $('#mMissing').innerHTML = missing.length ? `<section class="card"><h2>${missing.length} site${missing.length === 1 ? '' : 's'} without a map location <span class="chip" style="--c:var(--prog);margin-left:auto">fix postcode, then Locate sites</span></h2><div class="tablewrap" style="max-height:340px;box-shadow:none"><table><thead><tr><th>Site</th><th>Contract</th><th>Address</th><th>Postcode</th><th>Problem</th></tr></thead><tbody>${missing.map((r) => { const pc = r.postcode || ((r.address || '').match(PC_FIND) || [])[0] || ''; return `<tr data-id="${r.id}"><td><strong>${esc(r.name)}</strong></td><td>${esc(r.k?.name || '')}</td><td>${esc(r.address || '')}</td><td>${editable ? `<input data-pc value="${esc(pc)}" placeholder="e.g. SW7 1PD" style="max-width:130px" aria-label="Postcode for ${esc(r.name)}">` : esc(pc)}</td><td class="soft">${!pc ? 'No postcode' : r.geo_failed ? 'Postcode not found' : 'Not located yet'}</td></tr>`; }).join('')}</tbody></table></div></section>` : '';
  $$('[data-pc]').forEach((inp) => (inp.onchange = async () => { const v = inp.value.trim().toUpperCase(); if (v && !PC_FIND.test(v)) return toast("That doesn't look like a UK postcode.", true); const id = inp.closest('tr').dataset.id; await sb.from('sites').update({ postcode: v || null, geo_failed: null }).eq('id', id); inp.style.borderColor = 'var(--filled)'; toast('Postcode saved. Click Locate sites to place it.'); const s2 = sites.find((x) => String(x.id) === id); if (s2) { s2.postcode = v; s2.geo_failed = null; } }));
  if ($('#mLoc')) $('#mLoc').onclick = async () => { const btn = $('#mLoc'); btn.disabled = true; try { const n = await locateSites(sites, K, (t) => (btn.textContent = t)); toast(`${n} site${n === 1 ? '' : 's'} placed and saved.`); pageDataMap(); } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = 'Locate sites'; } };
}
function siteDetails(r, C, H) {
  if (!r) return;
  const covers = C.filter((c) => c.site_id === r.id), open = H.filter((h) => h.site_id === r.id && h.status !== 'Filled');
  dset('sitecv', `Covers this month · ${r.name}`, covers, [['date_from', 'Date'], ['kind', 'Type'], ['cover_cleaner', 'Cover cleaner'], ['state', 'Status', (x) => coverState(x)]]);
  drill('sitecv');
}

/* ---------- BrightHR live ---------- */
async function pageBrightHR() {
  const edit = can('brighthr', 'edit');
  const st = (S.bhr ||= { tab: 'today', q: '', site: '', type: '', from: '', to: '', status: 'active', cal: 'all' });
  const TABS = [['today', 'Today (live)'], ['overview', 'Overview'], ['people', 'People'], ['absences', 'Absences'], ['calendar', 'Calendar'], ['reports', 'Reports'], ['clock', 'Clock-ins (Blip)'], ['staff', 'Staff to site']];
  shell(`<div class="head"><div><div class="soft" id="bSync">People</div><h1>BrightHR</h1><p class="muted" style="margin:2px 0 0" id="bSub">Staff, absences and clock-ins from BrightHR, refreshed automatically.</p></div>
    <div class="row"><label class="f" style="min-width:300px">Find a person<input id="bFind" placeholder="Name, email, payroll no. or site" value="${esc(st.q)}" autocomplete="off"></label><button class="btn pri" id="bToday" title="Who is off and clocked in today, for everyone">Refresh today</button><button class="btn" id="bSyncNow" title="Staff list, absences −14 to +45 days, 7 days of clock-ins">Full sync</button>${edit ? '<button class="btn" id="bHist" title="Load 12 months of absence history">Load 12-month history</button>' : ''}</div></div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button role="tab" data-btab="${k}" aria-selected="${st.tab === k}" class="${st.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="bBody">${SKEL}</div>${siteList()}`);
  $$('[data-btab]').forEach((b) => (b.onclick = () => { st.tab = b.dataset.btab; pageBrightHR(); }));
  $('#bFind').onkeydown = (e) => { if (e.key === 'Enter') { st.q = e.target.value; st.tab = 'people'; pageBrightHR(); } };
  const runSync = async (btn, mode, label) => {
    const b = $(btn); b.disabled = true; let tot = { a: 0, c: 0 };
    try { for (let n = 0; n < 20; n++) { const r = await callFn('brighthr-sync', { action: 'sync', mode }); tot.a += r.absences || 0; tot.c += r.clockings || 0; b.textContent = `${label}… ${r.upto || 0} of ${r.total || '?'}`; if (r.done !== false) break; }
      toast(`${mode === 'today' ? 'Today refreshed' : 'Full sync done'}: ${tot.a} absences and ${tot.c} clock-ins checked.`); S.bhrData = null; pageBrightHR(); }
    catch (e) { toast(e.message + ' Progress is saved; press it again to continue.', true); b.disabled = false; b.textContent = label; }
  };
  $('#bToday').onclick = () => runSync('#bToday', 'today', 'Refreshing today');
  $('#bSyncNow').onclick = async () => {
    const b = $('#bSyncNow'); b.disabled = true; let tot = { a: 0, c: 0 };
    try { for (let n = 0; n < 15; n++) { const r = await callFn('brighthr-sync', { action: 'sync', mode: 'full' }); tot.a += r.absences || 0; tot.c += r.clockings || 0; b.textContent = `Syncing… ${r.upto || 0} of ${r.total || '?'}`; if (r.done !== false) break; }
      toast(`BrightHR synced: ${tot.a} absences and ${tot.c} clock-ins updated.`); S.bhrData = null; pageBrightHR(); }
    catch (e) { toast(e.message + ' Progress is saved; press Sync now again in a minute.', true); }
    b.disabled = false; b.textContent = 'Sync now';
  };
  if ($('#bHist')) $('#bHist').onclick = async () => {
    if (!confirm('Load 12 months of absence history from BrightHR? This runs in batches and can take 10–30 minutes. Keep this page open.')) return;
    const b = $('#bHist'); b.disabled = true;
    try { for (let n = 0; n < 60; n++) { const r = await callFn('brighthr-sync', { action: 'history' }); b.textContent = r.done ? 'History loaded' : `Month ${r.month}/12 · ${r.upto}/${r.total}`; if (r.done) break; } toast('12 months of absence history loaded.'); S.bhrData = null; pageBrightHR(); }
    catch (e) { toast(e.message + ' Press the button again to continue.', true); b.disabled = false; b.textContent = 'Continue history load'; }
  };
  // ---- data (cached for 2 minutes while you move between tabs)
  if (!S.bhrData || Date.now() - S.bhrData.at > 120000) {
    const [emps, abs, runs, cur] = await Promise.all([fetchAll('brighthr_employees', '*', (q) => q.order('name')), fetchAll('brighthr_absences', 'id,employee_id,employee,type,display_name,date_from,date_to,days,part,certified,note,estimated_return,sent_to_recruitment,cover_id'), sb.from('sync_runs').select('*').order('id', { ascending: false }).limit(1).then((r) => r.data || []), sb.from('settings').select('key,value').in('key', ['bhr_cursor', 'bhr_hist']).then((r) => r.data || [])]);
    S.bhrData = { emps, abs, run: runs[0], cur: Object.fromEntries(cur.map((x) => [x.key, x.value])), at: Date.now() };
  }
  if (!$('#bBody')) return;
  const { emps, abs, run, cur } = S.bhrData;
  if (run) { const mins = Math.round((Date.now() - new Date(run.finished_at || run.started_at)) / 60000); $('#bSync').innerHTML = run.error ? `<span class="err">Last sync failed: ${esc(String(run.error).slice(0, 120))}</span>` : `<span>People</span><span class="crumbsep">/</span><span>Synced ${mins < 1 ? 'just now' : mins < 60 ? mins + ' min ago' : mins < 1440 ? Math.round(mins / 60) + ' h ago' : Math.round(mins / 1440) + ' days ago'}${cur.bhr_hist?.done ? ' · 12-month history loaded' : ''}</span>`; }
  const today = new Date().toISOString().slice(0, 10), plus = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const E = new Map(emps.map((e) => [e.id, e])), siteOf = (id) => S.sites.find((x) => x.id === E.get(id)?.site_id)?.name || '';
  const amOf = (id) => { const sid = E.get(id)?.site_id; const s2 = S.sites.find((x) => x.id === sid); return s2 ? (S.contractsAM?.get(s2.contract_id) || '') : ''; };
  if (!S.contractsAM && can('contracts')) { const { data } = await sb.from('contracts').select('id,area_manager'); S.contractsAM = new Map((data || []).map((c) => [c.id, c.area_manager])); }
  const active = emps.filter((e) => !e.terminated), TC = { Sickness: '--unplanned', Holiday: '--planned', Other: '--raised', Toil: '--prog' };
  const daysOf = (a) => +a.days || Math.max(1, Math.round((new Date(a.date_to) - new Date(a.date_from)) / 864e5) + 1);
  const yearAgo = plus(-365);
  const sickBy = new Map(); abs.filter((a) => a.type === 'Sickness' && a.date_from >= yearAgo && a.date_from <= today).forEach((a) => { const x = sickBy.get(a.employee_id) || { spells: 0, days: 0 }; x.spells++; x.days += daysOf(a); sickBy.set(a.employee_id, x); });
  const bradford = (id) => { const x = sickBy.get(id); return x ? x.spells * x.spells * x.days : 0; };
  const tenure = (e) => { if (!e.start_date) return ''; const m = Math.floor((Date.now() - new Date(e.start_date)) / (30.44 * 864e5)); return m < 12 ? `${m} mo` : `${Math.floor(m / 12)} yr ${m % 12} mo`; };
  const ACOLS = [['employee', 'Name'], ['site', 'Site', (r) => siteOf(r.employee_id)], ['am', 'Area Manager', (r) => amOf(r.employee_id)], ['type', 'Type'], ['display_name', 'Reason'], ['date_from', 'From'], ['date_to', 'To'], ['days', 'Days', (r) => daysOf(r)], ['certified', 'Sick note', (r) => r.certified == null ? '' : r.certified ? 'Yes' : 'No'], ['estimated_return', 'Expected back'], ['sent', 'Sent to Recruitment', (r) => r.sent_to_recruitment ? 'Yes' : 'No']];
  const PCOLS = [['name', 'Name'], ['payroll_number', 'Payroll no.'], ['job_title', 'Job title'], ['email', 'Email'], ['site', 'Site', (r) => siteOf(r.id)], ['start_date', 'Started'], ['tenure', 'Service', (r) => tenure(r)], ['end_date', 'Leave date'], ['status', 'Status', (r) => r.terminated ? 'Left' : r.registered === false ? 'Not registered' : 'Active'], ['sick', 'Sick days (12m)', (r) => sickBy.get(r.id)?.days || 0], ['bf', 'Bradford', (r) => bradford(r.id)]];
  const kk = (l, v, sub, c, key, rows, cols) => `<div class="card kpi click" style="--c:var(${c})" ${dset(key, l, rows, cols)}><span>${l}</span><b>${v}</b><small>${sub}</small></div>`;
  const offOn = (d) => abs.filter((a) => a.date_from <= d && a.date_to >= d);
  const card = (h, body, extra = '') => `<section class="card" ${extra}><h2>${h}</h2>${body}</section>`;
  const body = $('#bBody');

  // ================= TODAY (live board, like BrightHR "Who's absent?")
  if (st.tab === 'today') {
    const { data: ckT } = await sb.from('brighthr_clockings').select('*').gte('clock_in', today).order('clock_in', { ascending: false });
    if (!$('#bBody')) return;
    const off = offOn(today), byType = (t) => off.filter((a) => a.type === t);
    const startDay = new Date(today + 'T00:00:00').getTime();
    const checked = active.filter((e) => e.checked_at && new Date(e.checked_at).getTime() >= startDay).length;
    const cov = active.length ? Math.round(checked / active.length * 100) : 0;
    const lastCk = active.map((e) => e.checked_at).filter(Boolean).sort().pop();
    const onShift = (ckT || []).filter((k) => !k.clock_out);
    const LBL = { Holiday: 'Annual leave', Sickness: 'Sickness', Toil: 'TOIL', Other: 'Other' };
    const filt = st.ttype || '';
    const shown = (filt ? byType(filt) : off).sort((a, b) => a.employee.localeCompare(b.employee));
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px">
      <section class="card" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:260px"><b>Today's data covers ${checked} of ${active.length} staff (${cov}%)</b><div style="height:8px;border-radius:99px;background:var(--track);margin:8px 0 4px;overflow:hidden"><div style="height:8px;width:${cov}%;background:var(${cov >= 95 ? '--filled' : cov >= 60 ? '--prog' : '--danger'})"></div></div><span class="soft">${lastCk ? 'Last person checked ' + new Date(lastCk).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Not checked yet today'} · the "today" job refreshes everyone every few minutes</span></div>
        <div class="soft" style="max-width:420px;font-size:12px">BrightHR's API only shares <b>approved</b> absences and Blip clock-ins. Pending requests, lateness, rotas and working status stay in BrightHR. <a href="https://app.brighthr.com/dashboard" target="_blank" rel="noopener">Open BrightHR ↗</a></div></section>
      <section class="grid">
        ${kk('Off today', off.length, 'approved absences', '--acc', 'bt0', off, ACOLS)}
        ${['Holiday', 'Sickness', 'Toil', 'Other'].map((t, i) => kk(LBL[t], byType(t).length, t === 'Sickness' ? 'needs covers' : 'today', TC[t], 'bt' + (i + 1), byType(t), ACOLS)).join('')}
        ${kk('Clocked in today', (ckT || []).length, onShift.length + ' on shift now', '--filled', 'bt6', ckT || [], [['employee', 'Name'], ['site', 'Site', (r) => siteOf(r.employee_id)], ['in', 'In', (r) => new Date(r.clock_in).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })], ['out', 'Out', (r) => r.clock_out ? new Date(r.clock_out).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : 'On shift']])}</section>
      <div class="row" style="align-items:center"><div class="seg" style="background:var(--panel2);border-color:var(--border)">${[['', 'All'], ['Holiday', 'Annual leave'], ['Sickness', 'Sickness'], ['Toil', 'TOIL'], ['Other', 'Other']].map(([v, l]) => `<button data-tt="${v}" class="${filt === v ? 'on' : ''}" style="color:var(--muted)">${l} ${v ? byType(v).length : off.length}</button>`).join('')}</div><span class="soft" style="margin-left:auto">Auto-refreshes every minute</span></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(270px,1fr))">${shown.map((a) => `<section class="card click" data-pp="${esc(a.employee_id)}" style="display:flex;gap:12px;align-items:flex-start;padding:14px"><div class="avatar" style="cursor:inherit;width:40px;height:40px;background:var(${TC[a.type] || '--hold'})">${esc((a.employee || '?').split(' ').map((x) => x[0]).slice(0, 2).join(''))}</div><div style="flex:1;min-width:0"><b style="color:var(--acc)">${esc(a.employee)}</b><div class="soft" style="font-size:12px">${esc(E.get(a.employee_id)?.job_title || '')}${siteOf(a.employee_id) ? ' · ' + esc(siteOf(a.employee_id)) : ''}</div><div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12.5px">${chip(LBL[a.type] || a.type, { [LBL[a.type] || a.type]: TC[a.type] || '--hold' })}<span class="soft">Ends ${new Date(a.date_to).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</span></div>${a.sent_to_recruitment ? '<div class="soft" style="font-size:11.5px;margin-top:4px">✓ sent to Recruitment</div>' : ''}</div></section>`).join('') || '<p class="muted">Nobody is off today (approved).</p>'}</div></div>`;
    $$('[data-tt]').forEach((b2) => (b2.onclick = () => { st.ttype = b2.dataset.tt; pageBrightHR(); }));
    $$('[data-pp]').forEach((x) => (x.onclick = () => profile(x.dataset.pp)));
    clearInterval(S.bhrTimer); S.bhrTimer = setInterval(() => { if (location.hash.startsWith('#/brighthr') && S.bhr.tab === 'today' && $('#modal').hidden) { S.bhrData = null; pageBrightHR(); } else if (!location.hash.startsWith('#/brighthr')) clearInterval(S.bhrTimer); }, 60000);
    return;
  }

  // ================= OVERVIEW
  if (st.tab === 'overview') {
    const offT = offOn(today), sickT = offT.filter((a) => a.type === 'Sickness');
    const starters = emps.filter((e) => e.start_date && e.start_date >= plus(-30) && e.start_date <= today), leavers = emps.filter((e) => e.end_date && e.end_date >= plus(-30) && e.end_date <= today);
    const last14 = abs.filter((a) => a.date_to >= plus(-14) && a.date_from <= today), lostDays = last14.reduce((s2, a) => s2 + daysOf(a), 0);
    const rate = active.length ? Math.round(lostDays / (active.length * 10) * 1000) / 10 : 0;   // 10 working days
    const watch = active.filter((e) => bradford(e.id) >= 200).sort((a, b) => bradford(b.id) - bradford(a.id));
    const rtw = abs.filter((a) => a.type === 'Sickness' && a.date_to >= plus(-7) && a.date_to < today);
    const unreg = active.filter((e) => e.registered === false), nosite = active.filter((e) => !e.site_id);
    const notSent = abs.filter((a) => a.date_from >= today && a.date_from <= plus(7) && !a.sent_to_recruitment);
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:16px"><section class="grid">
      ${kk('Active staff', fmtN(active.length), `${emps.length - active.length} leavers on record`, '--acc', 'bo1', active, PCOLS)}
      ${kk('Off today', offT.length, `${sickT.length} off sick`, '--unplanned', 'bo2', offT, ACOLS)}
      ${kk('Absence rate', rate + '%', 'days lost, last 2 weeks', '--danger', 'bo3', last14, ACOLS)}
      ${kk('Starters (30 days)', starters.length, 'new in BrightHR', '--filled', 'bo4', starters, PCOLS)}
      ${kk('Leavers (30 days)', leavers.length, 'leave date passed', '--hold', 'bo5', leavers, PCOLS)}
      ${kk('Bradford watchlist', watch.length, 'score 200+ (12 months)', '--raised', 'bo6', watch, PCOLS)}
      ${kk('Return-to-work due', rtw.length, 'sickness ended last 7 days', '--prog', 'bo7', rtw, ACOLS)}
      ${kk('Needs a decision', notSent.length, 'absences next 7 days not sent to Recruitment', '--offer', 'bo8', notSent, ACOLS)}
      ${kk('No site linked', nosite.length, 'link them in Staff to site', '--hold', 'bo9', nosite, PCOLS)}
      ${kk('Not registered', unreg.length, 'not yet using BrightHR app', '--hold', 'bo10', unreg, PCOLS)}</section>
      <section class="charts"><div class="card wide"><h2>Absence forecast · next 21 days</h2><canvas id="bF" height="70"></canvas></div>
        <div class="card"><h2>Absence by type · last 12 months</h2><canvas id="bT"></canvas></div><div class="card"><h2>Sites with most sickness · 12 months</h2><canvas id="bS"></canvas></div>
        <div class="card"><h2>Starters and leavers by month</h2><canvas id="bSL"></canvas></div><div class="card"><h2>Headcount by job title</h2><canvas id="bJ"></canvas></div></section>
      ${!cur.bhr_hist?.done ? '<p class="soft" style="margin:0">Tip: click "Load 12-month history" once so sickness totals, Bradford scores and yearly charts use a full year of data.</p>' : ''}</div>`;
    Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border');
    const days = [...Array(21)].map((_, i) => plus(i)), types = ['Holiday', 'Sickness', 'Other', 'Toil'];
    const mk = (id, c) => S.charts.push(new Chart($(id), c));
    mk('#bF', { type: 'bar', data: { labels: days.map((d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })), datasets: types.map((t) => ({ label: t, data: days.map((d) => offOn(d).filter((a) => a.type === t).length), backgroundColor: cssv(TC[t]), stack: 's', borderRadius: 3 })) }, options: { scales: { x: { stacked: true }, y: { stacked: true } }, onClick: (_, el) => { if (el.length) { const d = days[el[0].index]; dset('bfd', `Off on ${d}`, offOn(d), ACOLS); drill('bfd'); } } } });
    const y = abs.filter((a) => a.date_from >= yearAgo);
    mk('#bT', { type: 'doughnut', data: { labels: types, datasets: [{ data: types.map((t) => y.filter((a) => a.type === t).reduce((s2, a) => s2 + daysOf(a), 0)), backgroundColor: types.map((t) => cssv(TC[t])), borderWidth: 0 }] }, options: { cutout: '62%', onClick: (_, el) => { if (el.length) { const t = types[el[0].index]; dset('bty', `${t} · 12 months`, y.filter((a) => a.type === t), ACOLS); drill('bty'); } } } });
    const bs = {}; y.filter((a) => a.type === 'Sickness').forEach((a) => { const n = siteOf(a.employee_id) || 'Site not linked'; bs[n] = (bs[n] || 0) + daysOf(a); });
    const ts = Object.entries(bs).sort((a, b) => b[1] - a[1]).slice(0, 10);
    mk('#bS', { type: 'bar', data: { labels: ts.map((x) => x[0].slice(0, 28)), datasets: [{ data: ts.map((x) => x[1]), backgroundColor: cssv('--unplanned'), borderRadius: 5 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, onClick: (_, el) => { if (el.length) { const n = ts[el[0].index][0]; dset('bsx', `Sickness at ${n}`, y.filter((a) => a.type === 'Sickness' && (siteOf(a.employee_id) || 'Site not linked') === n), ACOLS); drill('bsx'); } } } });
    const ms = [...Array(12)].map((_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 11 + i); return d.toISOString().slice(0, 7); });
    mk('#bSL', { type: 'bar', data: { labels: ms.map((m) => MN[+m.slice(5) - 1]), datasets: [{ label: 'Starters', data: ms.map((m) => emps.filter((e) => e.start_date?.startsWith(m)).length), backgroundColor: cssv('--filled'), borderRadius: 4 }, { label: 'Leavers', data: ms.map((m) => emps.filter((e) => e.end_date?.startsWith(m)).length), backgroundColor: cssv('--danger'), borderRadius: 4 }] } });
    const jt = {}; active.forEach((e) => { const j = (e.job_title || 'Not set').trim(); jt[j] = (jt[j] || 0) + 1; });
    const jj = Object.entries(jt).sort((a, b) => b[1] - a[1]).slice(0, 10);
    mk('#bJ', { type: 'bar', data: { labels: jj.map((x) => x[0].slice(0, 26)), datasets: [{ data: jj.map((x) => x[1]), backgroundColor: cssv('--acc'), borderRadius: 5 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } }, onClick: (_, el) => { if (el.length) { const j = jj[el[0].index][0]; dset('bjx', `Job title: ${j}`, active.filter((e) => (e.job_title || 'Not set').trim() === j), PCOLS); drill('bjx'); } } } });
    return;
  }

  // ================= PEOPLE (directory + profile)
  if (st.tab === 'people') {
    const sites = [...new Set(active.map((e) => siteOf(e.id)).filter(Boolean))].sort();
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px"><div class="row"><label class="f" style="flex:1;min-width:260px">Search<input id="pQ" value="${esc(st.q)}" placeholder="Name, email, payroll number, job title or site"></label>
      <label class="f">Site<select id="pS"><option value="">All sites</option>${sites.map((x) => `<option ${st.site === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="f">Status<select id="pT">${[['active', 'Active'], ['left', 'Leavers'], ['unreg', 'Not registered'], ['nosite', 'No site'], ['watch', 'Bradford 200+'], ['all', 'Everyone']].map(([v, l]) => `<option value="${v}" ${st.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn" id="pX">Export list</button></div><div class="tablewrap" id="pW"></div></div>`;
    let list = [];
    const draw = () => {
      const q = $('#pQ').value.toLowerCase().trim(); st.q = q; st.site = $('#pS').value; st.status = $('#pT').value;
      list = emps.filter((e) => (st.status === 'all' || (st.status === 'active' && !e.terminated) || (st.status === 'left' && e.terminated) || (st.status === 'unreg' && !e.terminated && e.registered === false) || (st.status === 'nosite' && !e.terminated && !e.site_id) || (st.status === 'watch' && !e.terminated && bradford(e.id) >= 200))
        && (!st.site || siteOf(e.id) === st.site) && (!q || [e.name, e.email, e.payroll_number, e.job_title, siteOf(e.id)].join(' ').toLowerCase().includes(q)));
      $('#pW').innerHTML = `<table><thead><tr><th>Name</th><th>Payroll</th><th>Job title</th><th>Site</th><th>Service</th><th>Today</th><th>Sick days 12m</th><th>Bradford</th><th>Status</th></tr></thead><tbody>${list.slice(0, 500).map((e) => { const o = offOn(today).find((a) => a.employee_id === e.id), bf = bradford(e.id);
        return `<tr class="click" data-p="${esc(e.id)}"><td><strong>${esc(e.name)}</strong><br><span class="soft">${esc(e.email || '')}</span></td><td class="mono">${esc(e.payroll_number || '')}</td><td>${esc(e.job_title || '')}</td><td>${esc(siteOf(e.id) || '—')}</td><td>${tenure(e)}</td><td>${o ? chip(o.type, TC) : '<span class="soft">Working</span>'}</td><td class="mono">${sickBy.get(e.id)?.days || 0}</td><td>${bf ? `<span class="chip" style="--c:var(${bf >= 400 ? '--danger' : bf >= 200 ? '--prog' : '--hold'})">${bf}</span>` : ''}</td><td>${chip(e.terminated ? 'Left' : e.registered === false ? 'Not registered' : 'Active', { Active: '--filled', Left: '--hold', 'Not registered': '--prog' })}</td></tr>`; }).join('') || '<tr><td colspan="9" class="muted" style="padding:18px">Nobody matches.</td></tr>'}</tbody></table><div class="pager">${list.length} people${list.length > 500 ? ' (showing 500 – narrow the search or export)' : ''}</div>`;
      $$('[data-p]').forEach((tr) => (tr.onclick = () => profile(tr.dataset.p)));
    };
    $('#pQ').oninput = draw; $('#pS').onchange = draw; $('#pT').onchange = draw; $('#pX').onclick = () => exportRows('BrightHR people', list, PCOLS);
    draw(); if (st.q) $('#pQ').focus();
    return;
  }
  async function profile(id) {
    const e = E.get(id); const m = $('#modal'); m.hidden = false;
    const mine = abs.filter((a) => a.employee_id === id).sort((a, b) => b.date_from.localeCompare(a.date_from));
    const [{ data: ck }, { data: cv }] = await Promise.all([sb.from('brighthr_clockings').select('*').eq('employee_id', id).order('clock_in', { ascending: false }).limit(30), can('covers') ? sb.from('covers').select('date_from,site,kind,cover_cleaner,reason').ilike('absent_cleaner', `%${(e.name || '').trim().split(/\s+/)[0]}%${(e.name || '').trim().split(/\s+/).length > 1 ? (e.name || '').trim().split(/\s+/).at(-1) + '%' : ''}`).order('date_from', { ascending: false }).limit(20) : Promise.resolve({ data: [] })]);
    const sb12 = sickBy.get(id) || { spells: 0, days: 0 }, bf = bradford(id), up = mine.filter((a) => a.date_to >= today);
    const t = (x) => x ? new Date(x).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/London' }) : '';
    m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="${esc(e.name)}" style="width:min(1000px,100%)">
      <div class="head" style="padding-bottom:12px"><div style="display:flex;gap:14px;align-items:center;flex-direction:row"><div class="avatar" style="width:52px;height:52px;font-size:17px;cursor:default">${esc(e.name.split(' ').map((x) => x[0]).slice(0, 2).join(''))}</div><div><h1 style="font-size:20px">${esc(e.name)}</h1><div class="soft">${esc(e.job_title || 'No job title')} · ${esc(siteOf(id) || 'No site linked')}</div></div></div><div class="row"><button class="btn" id="prX">Export file</button><button class="btn pri" id="prC">Close</button></div></div>
      <section class="grid">${[['Payroll no.', e.payroll_number || '—'], ['Email', e.email || '—'], ['Started', e.start_date ? new Date(e.start_date).toLocaleDateString('en-GB') + ' · ' + tenure(e) : '—'], ['Status', e.terminated ? 'Left ' + (e.end_date || '') : e.registered === false ? 'Active · not registered' : 'Active'], ['Sickness (12m)', `${sb12.days} days · ${sb12.spells} spells`], ['Bradford factor', bf || 0]].map(([l, v]) => `<div class="card" style="padding:12px 14px"><div class="soft" style="font-size:12px;font-weight:600">${l}</div><div style="font-weight:600;margin-top:2px;word-break:break-word">${esc(String(v))}</div></div>`).join('')}</section>
      <div class="charts" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
        <section class="card"><h2>Absences</h2>${mine.length ? `<div class="list">${mine.slice(0, 15).map((a) => `<div><span>${chip(a.type, TC)} ${esc(a.display_name || '')}<br><span class="soft">${a.date_from} → ${a.date_to}${a.certified ? ' · sick note' : ''}</span></span><b>${daysOf(a)} d</b></div>`).join('')}</div>` : '<p class="muted" style="margin:0">No absences on record.</p>'}${up.length && can('covers', 'edit') ? `<button class="btn sm pri" id="prS" style="margin-top:10px">Send ${up.filter((a) => !a.sent_to_recruitment).length} upcoming to Recruitment</button>` : ''}</section>
        <section class="card"><h2>Recent clock-ins</h2>${ck?.length ? `<div class="list">${ck.slice(0, 12).map((k) => `<div><span>${t(k.clock_in)}<br><span class="soft">${k.clock_out ? 'out ' + t(k.clock_out).slice(-5) : 'on shift'}${k.note ? ' · ' + esc(k.note) : ''}</span></span><b>${k.worked_minutes != null ? (k.worked_minutes / 60).toFixed(2) + ' h' : ''}</b></div>`).join('')}</div>` : '<p class="muted" style="margin:0">No Blip clock-ins.</p>'}</section>
        <section class="card"><h2>Covers for this person</h2>${cv?.length ? `<div class="list">${cv.map((c) => `<div><span>${esc(c.site || '')}<br><span class="soft">${c.date_from} · ${esc(c.reason || c.kind)}</span></span><b>${esc(c.cover_cleaner || 'missed')}</b></div>`).join('')}</div>` : '<p class="muted" style="margin:0">No covers found.</p>'}</section></div></div>`;
    $('#prC').onclick = () => (m.hidden = true);
    $('#prX').onclick = () => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([Object.fromEntries(PCOLS.map(([k, l, f]) => [l, cellText(f ? f(e) : e[k])]))]), 'Details'); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(mine.map((r) => Object.fromEntries(ACOLS.map(([k, l, f]) => [l, cellText(f ? f(r) : r[k])])))), 'Absences'); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((ck || []).map((k) => ({ In: t(k.clock_in), Out: t(k.clock_out), Hours: k.worked_minutes != null ? (k.worked_minutes / 60).toFixed(2) : '', Note: k.note || '' }))), 'Clock-ins'); XLSX.writeFile(wb, `${e.name} staff file.xlsx`); };
    if ($('#prS')) $('#prS').onclick = async () => { let n = 0; for (const a of up.filter((x) => !x.sent_to_recruitment)) { try { const r = await callFn('brighthr-sync', { action: 'send_one', id: a.id }); n += r.created || 0; } catch (er) { toast(er.message, true); } } toast(`${n} cover row(s) created.`); S.bhrData = null; m.hidden = true; pageBrightHR(); };
  }

  // ================= ABSENCES register
  if (st.tab === 'absences') {
    st.from ||= plus(-14); st.to ||= plus(30);
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px"><div class="row"><label class="f">From<input type="date" id="aF" value="${st.from}"></label><label class="f">To<input type="date" id="aT" value="${st.to}"></label>
      <label class="f">Type<select id="aY"><option value="">All types</option>${['Sickness', 'Holiday', 'Other', 'Toil'].map((t) => `<option ${st.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="f">Site<select id="aS"><option value="">All sites</option>${[...new Set(abs.map((a) => siteOf(a.employee_id)).filter(Boolean))].sort().map((x) => `<option ${st.site === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <label class="f">Recruitment<select id="aR"><option value="">Any</option><option value="no">Not sent</option><option value="yes">Sent</option></select></label>
      <label class="f" style="flex:1;min-width:200px">Search<input id="aQ" placeholder="Name or reason"></label><button class="btn" id="aX">Excel</button><button class="btn" id="aC">CSV</button></div>
      <section class="grid" id="aK"></section><div class="tablewrap" id="aW"></div></div>`;
    let list = [];
    const draw = () => {
      st.from = $('#aF').value; st.to = $('#aT').value; st.type = $('#aY').value; st.site = $('#aS').value; const r = $('#aR').value, q = $('#aQ').value.toLowerCase();
      list = abs.filter((a) => a.date_to >= st.from && a.date_from <= st.to && (!st.type || a.type === st.type) && (!st.site || siteOf(a.employee_id) === st.site) && (!r || (r === 'yes') === !!a.sent_to_recruitment) && (!q || `${a.employee} ${a.display_name}`.toLowerCase().includes(q))).sort((a, b) => a.date_from.localeCompare(b.date_from));
      const dsum = list.reduce((s2, a) => s2 + daysOf(a), 0);
      $('#aK').innerHTML = kk('Absences', list.length, 'in this range', '--acc', 'ak1', list, ACOLS) + kk('Days', fmtN(dsum), 'total days', '--planned', 'ak2', list, ACOLS) + kk('Sickness', list.filter((a) => a.type === 'Sickness').length, 'spells', '--unplanned', 'ak3', list.filter((a) => a.type === 'Sickness'), ACOLS) + kk('Not sent', list.filter((a) => !a.sent_to_recruitment && a.date_to >= today).length, 'future, no cover decision', '--offer', 'ak4', list.filter((a) => !a.sent_to_recruitment && a.date_to >= today), ACOLS);
      $('#aW').innerHTML = `<table><thead><tr>${ACOLS.map(([, l]) => `<th>${l}</th>`).join('')}<th></th></tr></thead><tbody>${list.slice(0, 600).map((a) => `<tr><td><strong class="click" data-pp="${esc(a.employee_id)}">${esc(a.employee)}</strong></td><td>${esc(siteOf(a.employee_id))}</td><td>${esc(amOf(a.employee_id))}</td><td>${chip(a.type, TC)}</td><td>${esc(a.display_name || '')}</td><td class="mono">${a.date_from}</td><td class="mono">${a.date_to}</td><td class="mono">${daysOf(a)}</td><td>${a.certified == null ? '' : a.certified ? 'Yes' : 'No'}</td><td class="mono">${a.estimated_return || ''}</td><td>${a.sent_to_recruitment ? chip('Sent', { Sent: '--filled' }) : ''}</td>
        <td>${!a.sent_to_recruitment && a.date_to >= today && (edit || can('covers', 'edit')) ? `<button class="btn sm" data-send="${esc(a.id)}">Send to Recruitment</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="12" class="muted" style="padding:18px">No absences in this range.</td></tr>`}</tbody></table><div class="pager">${list.length} absences</div>`;
      $$('[data-pp]').forEach((x) => (x.onclick = () => profile(x.dataset.pp)));
      $$('[data-send]').forEach((b2) => (b2.onclick = async () => { b2.disabled = true; try { const r2 = await callFn('brighthr-sync', { action: 'send_one', id: b2.dataset.send }); toast(r2.created ? 'Sent to Recruitment as a cover.' : 'Already sent.'); const a = abs.find((x) => x.id === b2.dataset.send); if (a) a.sent_to_recruitment = true; draw(); } catch (e) { toast(e.message, true); b2.disabled = false; } }));
    };
    ['#aF', '#aT', '#aY', '#aS', '#aR'].forEach((x) => ($(x).onchange = draw)); $('#aQ').oninput = draw;
    $('#aX').onclick = () => exportRows(`Absence register ${st.from} to ${st.to}`, list, ACOLS); $('#aC').onclick = () => exportRows(`Absence register ${st.from} to ${st.to}`, list, ACOLS, 'csv');
    draw(); return;
  }

  // ================= CALENDAR (people x days)
  if (st.tab === 'calendar') {
    const N = 28, days = [...Array(N)].map((_, i) => plus(i - 3));
    const sites = [...new Set(active.map((e) => siteOf(e.id)).filter(Boolean))].sort();
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px"><div class="row"><label class="f">Site<select id="cS"><option value="">Everyone with an absence</option>${sites.map((x) => `<option ${st.site === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <div class="row" style="gap:12px;font-size:12px;color:var(--muted)">${Object.entries(TC).map(([k, c]) => `<span style="display:flex;align-items:center;gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:var(${c})"></span>${k}</span>`).join('')}</div></div><div class="tablewrap" id="cW" style="max-height:70vh"></div></div>`;
    const draw = () => {
      st.site = $('#cS').value;
      const people = active.filter((e) => (st.site ? siteOf(e.id) === st.site : abs.some((a) => a.employee_id === e.id && a.date_to >= days[0] && a.date_from <= days.at(-1))));
      $('#cW').innerHTML = `<table style="font-size:12px"><thead><tr><th style="position:sticky;left:0;background:var(--panel2);z-index:2">Person</th>${days.map((d) => { const dt = new Date(d); return `<th style="text-align:center;padding:6px 2px;${d === today ? 'color:var(--acc)' : ''}${[0, 6].includes(dt.getDay()) ? ';opacity:.6' : ''}">${'SMTWTFS'[dt.getDay()]}<br>${dt.getDate()}</th>`; }).join('')}</tr></thead><tbody>
        ${people.slice(0, 300).map((e) => `<tr><td style="position:sticky;left:0;background:var(--panel);white-space:nowrap" class="click" data-pp="${esc(e.id)}"><strong>${esc(e.name)}</strong><br><span class="soft">${esc(siteOf(e.id) || '')}</span></td>${days.map((d) => { const a = abs.find((x) => x.employee_id === e.id && x.date_from <= d && x.date_to >= d); return `<td style="padding:3px 2px;${d === today ? 'background:var(--accsoft)' : ''}" title="${a ? esc(`${a.type}: ${a.display_name || ''} (${a.date_from} to ${a.date_to})`) : ''}">${a ? `<span style="display:block;height:20px;border-radius:4px;background:var(${TC[a.type] || '--hold'});opacity:${a.part && a.part !== 'Full' ? .55 : .9}"></span>` : ''}</td>`; }).join('')}</tr>`).join('') || `<tr><td colspan="${N + 1}" class="muted" style="padding:18px">No absences in this period.</td></tr>`}</tbody></table>`;
      $$('[data-pp]').forEach((x) => (x.onclick = () => profile(x.dataset.pp)));
    };
    $('#cS').onchange = draw; draw(); return;
  }

  // ================= REPORTS
  if (st.tab === 'reports') {
    const R = [
      ['Absence register', 'Every absence in a date range, with site, Area Manager, reason and sick note.', true, (f, t) => abs.filter((a) => a.date_to >= f && a.date_from <= t), ACOLS],
      ['Sickness by person', 'Spells, days and Bradford factor for each person in the range.', true, (f, t) => { const m2 = new Map(); abs.filter((a) => a.type === 'Sickness' && a.date_to >= f && a.date_from <= t).forEach((a) => { const x = m2.get(a.employee_id) || { employee_id: a.employee_id, name: a.employee, spells: 0, days: 0, certified: 0 }; x.spells++; x.days += daysOf(a); x.certified += a.certified ? 1 : 0; m2.set(a.employee_id, x); }); return [...m2.values()].map((x) => ({ ...x, bradford: x.spells * x.spells * x.days })).sort((a, b) => b.bradford - a.bradford); }, [['name', 'Name'], ['site', 'Site', (r) => siteOf(r.employee_id)], ['spells', 'Spells'], ['days', 'Days'], ['certified', 'With sick note'], ['bradford', 'Bradford factor']]],
      ['Absence by site', 'Days lost per site and type, best for Area Manager reviews.', true, (f, t) => { const m2 = {}; abs.filter((a) => a.date_to >= f && a.date_from <= t).forEach((a) => { const s2 = siteOf(a.employee_id) || 'Site not linked'; const x = (m2[s2] ||= { site: s2, am: amOf(a.employee_id), Sickness: 0, Holiday: 0, Other: 0, Toil: 0, total: 0 }); x[a.type] = (x[a.type] || 0) + daysOf(a); x.total += daysOf(a); }); return Object.values(m2).sort((a, b) => b.total - a.total); }, [['site', 'Site'], ['am', 'Area Manager'], ['Sickness', 'Sickness days'], ['Holiday', 'Holiday days'], ['Other', 'Other days'], ['Toil', 'TOIL days'], ['total', 'Total days']]],
      ['Monthly summary', 'Absence days by type for each month.', false, () => { const m2 = {}; abs.forEach((a) => { const k = a.date_from.slice(0, 7); const x = (m2[k] ||= { month: k, Sickness: 0, Holiday: 0, Other: 0, Toil: 0, people: new Set() }); x[a.type] = (x[a.type] || 0) + daysOf(a); x.people.add(a.employee_id); }); return Object.values(m2).sort((a, b) => b.month.localeCompare(a.month)).map((x) => ({ ...x, people: x.people.size })); }, [['month', 'Month'], ['Sickness', 'Sickness days'], ['Holiday', 'Holiday days'], ['Other', 'Other days'], ['Toil', 'TOIL days'], ['people', 'People absent']]],
      ['Return-to-work interviews', 'Sickness that ended in the last 14 days; each needs an RTW conversation.', false, () => abs.filter((a) => a.type === 'Sickness' && a.date_to >= plus(-14) && a.date_to < today), ACOLS],
      ['Long-term sickness', 'Sickness absences of 20 days or more, or still open.', false, () => abs.filter((a) => a.type === 'Sickness' && (daysOf(a) >= 20 || (a.date_to >= today && a.date_from <= plus(-14)))), ACOLS],
      ['Holiday planner', 'Holidays in the next 45 days, by site, for cover planning.', false, () => abs.filter((a) => a.type === 'Holiday' && a.date_to >= today && a.date_from <= plus(45)).sort((a, b) => a.date_from.localeCompare(b.date_from)), ACOLS],
      ['Bradford watchlist', 'People with a Bradford score of 200+ over 12 months.', false, () => active.filter((e) => bradford(e.id) >= 200).sort((a, b) => bradford(b.id) - bradford(a.id)), PCOLS],
      ['Staff list', 'Everyone in BrightHR with payroll number, site and status.', false, () => emps, PCOLS],
      ['Starters and leavers', 'Joined or left in the date range.', true, (f, t) => emps.filter((e) => (e.start_date >= f && e.start_date <= t) || (e.end_date >= f && e.end_date <= t)), PCOLS],
      ['Clock-ins (Blip)', 'Every clock-in in the date range with hours worked.', true, 'clock', null],
    ];
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px"><div class="row"><label class="f">From<input type="date" id="rF" value="${plus(-30)}"></label><label class="f">To<input type="date" id="rT" value="${today}"></label><button class="btn pri" id="rAll">Download all reports (one Excel)</button></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(310px,1fr))">${R.map(([t, d, ranged], i) => `<section class="card" style="display:flex;flex-direction:column;gap:8px"><h2>${ICON(I.doc)} ${t}</h2><p class="muted" style="margin:0;flex:1">${d}${ranged ? ' <span class="chip" style="--c:var(--planned)">uses date range</span>' : ''}</p><div class="row"><button class="btn sm" data-rv="${i}">View</button><button class="btn sm" data-rx="${i}">Excel</button><button class="btn sm" data-rc="${i}">CSV</button></div></section>`).join('')}</div></div>`;
    const getR = async (i) => { const [t, , , fn, cols] = R[i], f = $('#rF').value, to = $('#rT').value;
      if (fn === 'clock') { const { data } = await sb.from('brighthr_clockings').select('*').gte('clock_in', f).lte('clock_in', to + 'T23:59:59').order('clock_in'); return [t, data || [], [['employee', 'Name'], ['site', 'Site', (r) => siteOf(r.employee_id)], ['in', 'Clock in', (r) => new Date(r.clock_in).toLocaleString('en-GB', { timeZone: 'Europe/London' })], ['out', 'Clock out', (r) => r.clock_out ? new Date(r.clock_out).toLocaleString('en-GB', { timeZone: 'Europe/London' }) : 'On shift'], ['break_minutes', 'Break mins'], ['h', 'Hours', (r) => r.worked_minutes != null ? (r.worked_minutes / 60).toFixed(2) : ''], ['note', 'Note']]]; }
      return [t, fn(f, to), cols]; };
    $$('[data-rv]').forEach((b) => (b.onclick = async () => { const [t, rows, cols] = await getR(+b.dataset.rv); dset('rv', t, rows, cols); drill('rv'); }));
    $$('[data-rx]').forEach((b) => (b.onclick = async () => { const [t, rows, cols] = await getR(+b.dataset.rx); exportRows(`${t} ${$('#rF').value} to ${$('#rT').value}`, rows, cols); }));
    $$('[data-rc]').forEach((b) => (b.onclick = async () => { const [t, rows, cols] = await getR(+b.dataset.rc); exportRows(`${t} ${$('#rF').value} to ${$('#rT').value}`, rows, cols, 'csv'); }));
    $('#rAll').onclick = async () => { const wb = XLSX.utils.book_new(); for (let i = 0; i < R.length; i++) { const [t, rows, cols] = await getR(i); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map((r) => Object.fromEntries(cols.map(([k, l, f]) => [l, cellText(f ? f(r) : r[k])])))), t.slice(0, 31)); } XLSX.writeFile(wb, `BrightHR reports ${$('#rF').value} to ${$('#rT').value}.xlsx`); };
    return;
  }

  const load = () => pageBrightHR();
  const clockTab = async () => {
    const today = new Date().toISOString().slice(0, 10), since = new Date(Date.now() - 14 * 864e5).toISOString();
    const [emps, clk, { data: offs }] = await Promise.all([fetchAll('brighthr_employees', 'id,name,site_id', (q) => q.eq('terminated', false)), fetchAll('brighthr_clockings', '*', (q) => q.gte('clock_in', since)), sb.from('brighthr_absences').select('employee_id,type').lte('date_from', today).gte('date_to', today)]);
    if (!$('#bBody')) return;
    const off = new Map((offs || []).map((o) => [o.employee_id, o.type]));
    const siteN = (id) => S.sites.find((x) => x.id === id)?.name || '';
    const now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes(), dow = now.getDay();
    const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const tm = (iso) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    const rows = emps.map((e) => {
      const mine = clk.filter((k) => k.employee_id === e.id), tod = mine.filter((k) => k.clock_in.slice(0, 10) === today).sort((a, b) => a.clock_in.localeCompare(b.clock_in));
      const same = mine.filter((k) => new Date(k.clock_in).getDay() === dow && k.clock_in.slice(0, 10) !== today).map((k) => { const d = new Date(k.clock_in); return d.getHours() * 60 + d.getMinutes(); }).sort((a, b) => a - b);
      const usual = same.length >= 2 ? same[Math.floor(same.length / 2)] : null;
      const first = tod[0], startMin = first ? new Date(first.clock_in).getHours() * 60 + new Date(first.clock_in).getMinutes() : null;
      const week = mine.filter((k) => new Date(k.clock_in) > new Date(Date.now() - 7 * 864e5)).reduce((t, k) => t + ((k.worked_minutes || 0) / 60), 0);
      let status = 'Not expected';
      if (off.has(e.id)) status = 'Off: ' + off.get(e.id);
      else if (first) status = tod.some((k) => !k.clock_out) ? 'Clocked in' : 'Clocked out';
      else if (usual != null) status = nowMin >= usual + 30 ? 'Not clocked in' : 'Due later';
      const late = first && usual != null && startMin > usual + 15;
      return { ...e, site: siteN(e.site_id), status, late, usual: usual != null ? hm(usual) : '', in: first ? tm(first.clock_in) : '', out: tod.length && tod.at(-1).clock_out ? tm(tod.at(-1).clock_out) : '', today_h: tod.reduce((t, k) => t + ((k.worked_minutes || 0) / 60), 0).toFixed(2), week_h: week.toFixed(1) };
    });
    const ORDER = { 'Not clocked in': 0, 'Clocked in': 1, 'Due later': 2, 'Clocked out': 3 };
    rows.sort((a, b) => (ORDER[a.status] ?? 5) - (ORDER[b.status] ?? 5) || a.name.localeCompare(b.name));
    const SC = { 'Not clocked in': '--danger', 'Clocked in': '--filled', 'Clocked out': '--planned', 'Due later': '--prog' };
    const missing = rows.filter((r) => r.status === 'Not clocked in'), inNow = rows.filter((r) => r.status === 'Clocked in'), late = rows.filter((r) => r.late);
    const CC = [['name', 'Name'], ['site', 'Site'], ['status', 'Status'], ['usual', 'Usually in'], ['in', 'In today'], ['out', 'Out today'], ['today_h', 'Hours today'], ['week_h', 'Hours (7 days)']];
    const kk = (l, v, sub, c, key, list) => `<div class="card kpi click" style="--c:var(${c})" ${dset(key, l, list, CC)}><span>${l}</span><b>${v}</b><small>${sub}</small></div>`;
    $('#bBody').innerHTML = `<div style="display:flex;flex-direction:column;gap:16px"><section class="grid">${kk('Clocked in now', inNow.length, 'on shift', '--filled', 'bk1', inNow)}${kk('Not clocked in', missing.length, '30+ min past their usual time', '--danger', 'bk2', missing)}${kk('Late today', late.length, '15+ min after usual start', '--prog', 'bk3', late)}${kk('Hours this week', fmtN(Math.round(rows.reduce((t, r) => t + +r.week_h, 0))), 'clocked in Blip, last 7 days', '--planned', 'bk4', rows.filter((r) => +r.week_h > 0))}</section>
      <p class="soft" style="margin:0">"Usually in" is learned from each person's last 2 weeks of Blip clock-ins on the same weekday. People with no pattern show as "Not expected". Link people to sites in the Staff to site tab.</p>
      <div class="tablewrap"><table><thead><tr><th>Name</th><th>Site</th><th>Status</th><th>Usually in</th><th>In today</th><th>Out</th><th>Hours today</th><th>Hours (7 days)</th><th></th></tr></thead><tbody>
      ${rows.filter((r) => r.status !== 'Not expected').map((r) => `<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.site || '—')}</td><td>${chip(r.status, SC)}${r.late ? ' ' + chip('Late', { Late: '--prog' }) : ''}</td><td class="mono">${r.usual}</td><td class="mono">${r.in}</td><td class="mono">${r.out}</td><td class="mono">${r.today_h}</td><td class="mono">${r.week_h}</td>
        <td>${r.status === 'Not clocked in' && can('covers', 'edit') ? `<button class="btn sm pri" data-nc="${esc(r.id)}">Create cover</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="muted" style="padding:20px">No clock-in data yet. Press Sync now.</td></tr>'}</tbody></table></div></div>`;
    $$('[data-nc]').forEach((b2) => (b2.onclick = async () => { b2.disabled = true; try { await callFn('brighthr-sync', { action: 'noclock_cover', employee_id: b2.dataset.nc }); toast('Unplanned cover created for Recruitment.'); b2.textContent = 'Cover created'; } catch (e) { toast(e.message, true); b2.disabled = false; } }));
  };

  const staffTab = async () => {
    const emps = await fetchAll('brighthr_employees', '*', (q) => q.eq('terminated', false).order('name'));
    const unset = emps.filter((e) => !e.site_id).length;
    $('#bBody').innerHTML = `<p class="muted">BrightHR doesn't store sites, so link each cleaner to their site once. ${unset} of ${emps.length} still need a site.</p>
      <div class="row"><label class="f">Search<input id="eS" placeholder="Name"></label><label class="f"><span><input type="checkbox" id="eU"> Only show missing sites</span></label>${edit ? '<button class="btn pri" id="eAuto">Suggest sites automatically</button>' : ''}</div><div id="eSug"></div>
      <div class="tablewrap" id="eWrap"></div>`;
    const draw = () => {
      const s = $('#eS').value.toLowerCase(), u = $('#eU').checked;
      $('#eWrap').innerHTML = `<table><thead><tr><th>Name</th><th>Job title</th><th>Email</th><th>Site</th></tr></thead><tbody>${emps.filter((e) => (!s || (e.name || '').toLowerCase().includes(s)) && (!u || !e.site_id)).map((e) => `<tr data-id="${esc(e.id)}"><td><strong>${esc(e.name)}</strong></td><td>${esc(e.job_title || '')}</td><td>${esc(e.email || '')}</td>
        <td>${edit ? `<input data-site list="siteList" value="${esc(S.sites.find((x) => x.id === e.site_id)?.name || '')}" aria-label="Site for ${esc(e.name)}" style="min-width:260px">` : esc(S.sites.find((x) => x.id === e.site_id)?.name || '—')}</td></tr>`).join('')}</tbody></table>`;
      $$('[data-site]').forEach((i) => (i.onchange = async () => {
        const site = S.sites.find((x) => x.name.toLowerCase() === i.value.trim().toLowerCase());
        if (i.value && !site) return toast('Pick a site from the list.', true);
        const id = i.closest('tr').dataset.id; const { error } = await sb.from('brighthr_employees').update({ site_id: site?.id || null }).eq('id', id);
        if (error) toast(error.message, true); else { emps.find((e) => e.id === id).site_id = site?.id || null; i.style.borderColor = 'var(--filled)'; }
      }));
    };
    $('#eS').oninput = draw; $('#eU').onchange = draw; draw();
    if ($('#eAuto')) $('#eAuto').onclick = async () => {
      $('#eAuto').disabled = true; $('#eAuto').textContent = 'Checking covers history…';
      const cov = await fetchAll('covers', 'absent_cleaner,site_id', (q) => q.not('site_id', 'is', null).not('absent_cleaner', 'is', null));
      const nm = (x) => String(x || '').toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
      const idx = new Map(); cov.forEach((c) => { const k = nm(c.absent_cleaner); if (!k) return; const m2 = idx.get(k) || new Map(); m2.set(c.site_id, (m2.get(c.site_id) || 0) + 1); idx.set(k, m2); });
      const sug = emps.filter((e) => !e.site_id).map((e) => { const full = nm(e.name), parts = full.split(' '); let m2 = idx.get(full) || idx.get(parts[0] + ' ' + parts.at(-1)); if (!m2) for (const [k, v] of idx) { if (k.split(' ')[0] === parts[0] && k.includes(parts.at(-1))) { m2 = v; break; } }
        if (!m2) return null; const [sid, n] = [...m2.entries()].sort((a, b) => b[1] - a[1])[0]; return { e, sid, n, site: S.sites.find((x) => x.id === sid)?.name }; }).filter((x) => x && x.site);
      $('#eAuto').disabled = false; $('#eAuto').textContent = 'Suggest sites automatically';
      if (!sug.length) return toast('No matches found in covers history.', true);
      $('#eSug').innerHTML = `<section class="card" style="display:flex;flex-direction:column;gap:10px"><h2>${sug.length} suggestions from covers history</h2><p class="muted" style="margin:0">Each person was found as the absent cleaner on covers at this site. Untick any that look wrong.</p>
        <div class="tablewrap" style="max-height:320px"><table><thead><tr><th></th><th>Person</th><th>Suggested site</th><th>Seen</th></tr></thead><tbody>${sug.map((x, i) => `<tr><td><input type="checkbox" data-sg="${i}" checked aria-label="Apply"></td><td>${esc(x.e.name)}</td><td>${esc(x.site)}</td><td>${x.n} cover${x.n > 1 ? 's' : ''}</td></tr>`).join('')}</tbody></table></div><button class="btn pri" id="eApply">Apply ticked</button></section>`;
      $('#eApply').onclick = async () => { const pick = sug.filter((_, i) => $(`[data-sg="${i}"]`).checked); for (const x of pick) { await sb.from('brighthr_employees').update({ site_id: x.sid }).eq('id', x.e.id); x.e.site_id = x.sid; } toast(`${pick.length} people linked to sites.`); S.bhrData = null; $('#eSug').innerHTML = ''; draw(); };
    };
  };

  if (st.tab === 'clock') return clockTab();
  if (st.tab === 'staff') return staffTab();
}

/* ---------- contracts ---------- */
async function pageContracts() {
  const edit = can('contracts', 'edit');
  shell(`<div class="head"><div><div class="soft">Contracts</div><h1>Contracts and sites</h1></div><div class="row"><label class="f">Search<input id="kS" placeholder="Contract name" value="${esc(S.kq || '')}"></label>${canFlag('contracts', 'can_export') ? '<button class="btn" id="kExp">Export</button>' : ''}${themeSwitch()}</div></div><div class="tablewrap" id="kWrap">Loading…</div>`);
  const rows = await fetchAll('contracts', '*', (q) => q.order('name'));
  if (!$('#kWrap')) return; S.kq = '';
  const draw = () => {
    const s = $('#kS').value.toLowerCase(), list = rows.filter((r) => !s || r.name.toLowerCase().includes(s));
    const inp = (x, f, type = 'text') => edit ? `<input data-f="${f}" type="${type}" value="${esc(x[f] ?? '')}" aria-label="${f}">` : esc(x[f] ?? '');
    $('#kWrap').innerHTML = `<table><thead><tr><th>Contract</th><th>Sector</th><th>Region</th><th>Start</th><th>End</th><th>Year 1 £/hr</th><th>Year 2 £/hr</th><th>Uplift %</th><th>Monthly value Y1 £</th><th>Monthly value Y2 £</th><th>Weekly hours</th><th>Target margin %</th><th>Postcode</th><th>Area Manager</th><th>Customer Care</th><th>Year 2 due</th><th></th></tr></thead><tbody>
      ${list.map((x) => { const due = x.start_date ? new Date(new Date(x.start_date).setFullYear(new Date(x.start_date).getFullYear() + 1)) : null; const soon = due && due - new Date() < 30 * 864e5;
        return `<tr data-id="${x.id}"><td style="font-weight:600;min-width:220px">${esc(x.name)}</td><td>${inp(x, 'sector')}</td><td>${inp(x, 'region')}</td><td>${inp(x, 'start_date', 'date')}</td><td>${inp(x, 'end_date', 'date')}</td><td>${inp(x, 'year1_rate')}</td><td>${inp(x, 'year2_rate')}</td><td>${inp(x, 'uplift_pct')}</td><td>${inp(x, 'monthly_value')}</td><td>${inp(x, 'monthly_value_y2')}</td><td>${inp(x, 'weekly_hours')}</td><td>${inp(x, 'target_margin_pct')}</td><td>${inp(x, 'postcode')}</td><td>${inp(x, 'area_manager')}</td><td>${inp(x, 'ccm')}</td>
        <td>${due ? `<span class="chip" style="--c:var(${soon ? '--prog' : '--hold'})">${due.toLocaleDateString('en-GB')}</span>` : '—'}</td><td style="white-space:nowrap"><button class="btn sm" data-kd="${x.id}" title="Documents">📄</button> <button class="btn sm" data-kc="${x.id}" title="Comments">💬</button></td></tr>`; }).join('')}</tbody></table><div class="pager">${list.length} contracts</div>`;
    bindEdits('contracts', $('#kWrap'));
    $$('[data-kd]').forEach((b) => (b.onclick = () => openDocs('contract', b.dataset.kd, rows.find((r) => r.id === b.dataset.kd)?.name || 'Contract')));
    $$('[data-kc]').forEach((b) => (b.onclick = () => openComments('contract', b.dataset.kc, rows.find((r) => r.id === b.dataset.kc)?.name || 'Contract')));
  };
  $('#kS').oninput = draw; if ($('#kExp')) $('#kExp').onclick = () => downloadCsv('contracts.csv', rows); draw();
}

/* ---------- admin ---------- */
/* notifications bell */
async function bellCount() {
  const { count } = await sb.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  const n = $('#bellN'); if (!n) return; n.hidden = !count; n.textContent = count > 99 ? '99+' : count;
}
setInterval(() => S.profile && $('#bell') && bellCount(), 60000);
async function openBell() {
  const m = $('#modal'); m.hidden = false;
  const { data } = await sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
  const ago = (t) => { const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : new Date(t).toLocaleDateString('en-GB'); };
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Notifications"><div class="head" style="align-items:center"><h2>Notifications</h2><div class="row"><button class="btn sm" id="nAll">Mark all read</button><button class="btn sm" id="nClose">Close</button></div></div>
    <div class="list nlist">${(data || []).map((n) => `<div class="${n.read_at ? '' : 'unread'}"><a href="${esc(n.link || '#/home')}" data-n="${n.id}" style="color:inherit;text-decoration:none;flex:1"><strong>${esc(n.title)}</strong><br><span class="muted">${esc(n.body || '')}</span></a><span class="soft" style="white-space:nowrap">${ago(n.created_at)}</span></div>`).join('') || '<p class="muted">Nothing yet. Choose what you get in My settings.</p>'}</div>
    <a href="#/settings" id="nSet">Notification settings</a></div>`;
  $('#nClose').onclick = () => (m.hidden = true);
  $('#nSet').onclick = () => (m.hidden = true);
  $('#nAll').onclick = async () => { await sb.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); m.hidden = true; bellCount(); };
  $$('[data-n]').forEach((a) => (a.onclick = async () => { m.hidden = true; await sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', a.dataset.n); bellCount(); }));
}

/* my settings */
async function pageSettings() {
  shell(`<div class="head"><div><div class="soft">${esc(S.profile.email)}</div><h1>My settings</h1></div><div class="row">${themeSwitch()}</div></div>
    <section class="card"><h2>Change password</h2><form class="row" id="pw" style="margin-top:12px"><label class="f">New password (min 10)<input type="password" name="pw" minlength="10" required autocomplete="new-password"></label><button class="btn pri">Save password</button></form></section>
    <section class="card" style="padding:0"><div style="padding:18px"><h2>Notifications</h2><p class="muted" style="margin:6px 0 0">In the portal shows in the bell. Email sends one summary each morning.</p></div><div class="tablewrap" id="np" style="border:none;border-radius:0">Loading…</div></section>
    <section class="card"><h2>My access</h2><div class="list" style="margin-top:8px">${SECTIONS.map(([s, l]) => `<div><span>${l}</span><b>${isAdmin() ? 'Full' : (S.perms[s]?.level || 'none').replace('none', 'No access')}</b></div>`).join('')}</div></section>`);
  $('#pw').onsubmit = async (e) => { e.preventDefault(); const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get('pw') }); toast(error ? error.message : 'Password changed.', !!error); if (!error) e.target.reset(); };
  const { data: prefs } = await sb.from('notification_prefs').select('*').eq('user_id', S.user.id);
  const P = Object.fromEntries((prefs || []).map((p) => [p.kind, p]));
  const mine = KINDS.filter(([, , sec]) => can(sec) || (sec === 'admin' && isAdmin()));
  $('#np').innerHTML = `<table class="perm"><thead><tr><th>Alert</th><th>In the portal</th><th>Daily email</th></tr></thead><tbody>${mine.map(([k, l]) => `<tr data-k="${k}"><td>${l}</td><td><input type="checkbox" data-c="in_app" ${P[k]?.in_app === false ? '' : 'checked'} aria-label="${l} in portal"></td><td><input type="checkbox" data-c="email" ${P[k]?.email ? 'checked' : ''} aria-label="${l} by email"></td></tr>`).join('')}</tbody></table>`;
  $$('#np [data-c]').forEach((c) => (c.onchange = async () => {
    const tr = c.closest('tr'), k = tr.dataset.k;
    const row = { user_id: S.user.id, kind: k, in_app: $('[data-c=in_app]', tr).checked, email: $('[data-c=email]', tr).checked };
    const { error } = await sb.from('notification_prefs').upsert(row); toast(error ? error.message : 'Saved.', !!error);
  }));
}

/* admin */
async function pageAdmin() {
  const tab = (S.adminTab ||= 'users');
  shell(`<div class="head"><div><div class="soft">Super Admin</div><h1>Admin</h1></div><div class="row">${themeSwitch()}</div></div>
    <div class="tabs" role="tablist">${[['users','Users and access'],['templates','Role templates'],['ai','AI'],['log','Activity log'],['email','Email settings'],['review','Import review']].map(([k, l]) => `<button role="tab" data-at="${k}" aria-selected="${tab === k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="aBody">${SKEL}</div>`);
  $$('[data-at]').forEach((b) => (b.onclick = () => { S.adminTab = b.dataset.at; pageAdmin(); }));
  ({ users: adminUsers, templates: adminTemplates, ai: adminAI, log: adminLog, email: adminEmail, review: adminReview })[tab]();
}
const showPassword = (title, email, pw) => {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><p class="muted" style="margin:0">Share these with the person (WhatsApp or in person). They'll be asked to choose their own password at first sign-in. This password won't be shown again.</p>
    <div class="card" style="gap:6px"><div>Portal: <b>${esc(location.origin)}</b></div><div>Email: <b>${esc(email)}</b></div><div>Temporary password: <b class="mono" style="font-size:18px">${esc(pw)}</b></div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="pwCopy">Copy details</button><button class="btn pri" id="pwOk">Done</button></div></div>`;
  $('#pwCopy').onclick = async () => { await navigator.clipboard.writeText(`Crystal FM portal: ${location.origin}\nEmail: ${email}\nTemporary password: ${pw}\nYou'll choose your own password when you first sign in.`); toast('Copied.'); };
  $('#pwOk').onclick = () => { m.hidden = true; adminUsers(); };
};
async function adminUsers() {
  const [{ data: ps }, { data: pm }, { data: tpl }] = await Promise.all([sb.from('profiles').select('*').order('full_name'), sb.from('permissions').select('*'), sb.from('role_templates').select('*').order('name')]);
  const access = (u) => u.role === 'super_admin' ? 'Everything' : SECTIONS.filter(([s]) => ['view', 'edit'].includes(pm.find((p) => p.user_id === u.id && p.section === s)?.level)).map(([, l]) => l).join(', ') || 'No access';
  $('#aBody').innerHTML = `<div style="display:flex;flex-direction:column;gap:18px">
    <section class="card"><h2>Add a person</h2><form class="row" id="add" style="margin-top:12px">
      <label class="f">Full name<input name="full_name" required></label><label class="f">Work email<input name="email" type="email" required></label>
      <label class="f">Team<select name="team">${['Recruitment','Customer Care','Operations','HR','Finance','Contracts'].map((t) => `<option>${t}</option>`).join('')}</select></label>
      <label class="f">Starting access<select name="template"><option value="">No access (set it yourself)</option>${tpl.map((t) => `<option>${esc(t.name)}</option>`).join('')}</select></label>
      <label class="f">Name in Recruiter column<input name="recruiter_name" placeholder="e.g. Ramsha"></label>
      <button class="btn pri">Add person</button></form></section>
    <div class="row"><label class="f">Search<input id="uS" placeholder="Name or email"></label><label class="f">Show<select id="uF"><option value="active">Active</option><option value="inactive">Removed</option><option value="all">Everyone</option></select></label></div>
    <div class="tablewrap" id="uT"></div></div>`;
  $('#add').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const b = e.target.querySelector('.pri'); b.disabled = true;
    try { const r = await callFn('admin-users', { action: 'create', ...f }); showPassword('Person added', f.email, r.password); } catch (er) { toast(er.message, true); } b.disabled = false;
  };
  const draw = () => {
    const q = $('#uS').value.toLowerCase(), f = $('#uF').value;
    const list = ps.filter((u) => (!q || (u.full_name + u.email).toLowerCase().includes(q)) && (f === 'all' || (f === 'active') === u.active));
    $('#uT').innerHTML = `<table><thead><tr><th>Person</th><th>Team</th><th>Role</th><th>Can see</th><th>Last active</th><th>Status</th><th></th></tr></thead><tbody>${list.map((u) => `<tr data-u="${u.id}">
      <td><strong>${esc(u.full_name)}</strong><br><span class="soft">${esc(u.email)}</span></td><td>${esc(u.team || '')}</td><td>${esc(u.role.replace('_', ' '))}</td><td style="max-width:320px">${esc(access(u))}</td>
      <td class="mono">${u.last_seen ? new Date(u.last_seen).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : 'never'}</td>
      <td>${chip(u.active ? (u.must_change_password ? 'Awaiting first login' : 'Active') : 'Removed', { Active: '--filled', 'Awaiting first login': '--prog', Removed: '--danger' })}</td>
      <td style="white-space:nowrap">${u.role === 'super_admin' ? '<span class="soft">Super admin</span>' : `<button class="btn sm pri" data-a="manage">Manage access</button> <button class="btn sm" data-a="reset_password">Reset password</button> ${u.active ? '<button class="btn sm" data-a="deactivate">Remove access</button>' : '<button class="btn sm" data-a="reactivate">Restore</button> <button class="btn sm" data-a="delete">Delete forever</button>'}`}</td></tr>`).join('')}</tbody></table>`;
    $$('#uT [data-a]').forEach((b) => (b.onclick = async () => {
      const u = ps.find((x) => x.id === b.closest('tr').dataset.u), a = b.dataset.a;
      if (a === 'manage') return manageUser(u, pm.filter((p) => p.user_id === u.id), tpl);
      const msg = { reset_password: `Give ${u.full_name} a new temporary password?`, deactivate: `Remove ${u.full_name}'s access? They are signed out and can't log in. You can restore them later.`, reactivate: `Restore ${u.full_name}'s access?`, delete: `Delete ${u.full_name} permanently? Their history stays in the activity log.` }[a];
      if (!confirm(msg)) return;
      try { const r = await callFn('admin-users', { action: a, id: u.id }); if (r.password) showPassword('New temporary password', u.email, r.password); else { toast('Done.'); adminUsers(); } } catch (e) { toast(e.message, true); }
    }));
  };
  $('#uS').oninput = draw; $('#uF').onchange = draw; draw();
}
function manageUser(u, perms, tpl) {
  const P = Object.fromEntries(perms.map((p) => [p.section, p]));
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Access for ${esc(u.full_name)}" style="width:min(1100px,100%)">
    <div class="head" style="align-items:center"><div><h2>${esc(u.full_name)}</h2><span class="soft">${esc(u.email)}</span></div><div class="row"><label class="f">Quick start from a template<select id="mT"><option value="">Choose…</option>${tpl.map((t) => `<option>${esc(t.name)}</option>`).join('')}</select></label><button class="btn" id="mApply">Apply template</button></div></div>
    <div class="row"><label class="f">Full name<input id="mName" value="${esc(u.full_name)}"></label><label class="f">Team<select id="mTeam">${['','Recruitment','Customer Care','Operations','HR','Finance','Contracts'].map((t) => `<option ${u.team === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="f">Role<select id="mRole">${[['member','Member'],['team_lead','Team lead'],['viewer','Viewer']].map(([v, l]) => `<option value="${v}" ${u.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f">Name in Recruiter column<input id="mRec" value="${esc(u.recruiter_name || '')}" placeholder="for 'own records only'"></label><label class="f">Phone<input id="mPhone" value="${esc(u.phone || '')}"></label></div>
    <div class="tablewrap"><table class="perm"><thead><tr><th>Section</th><th>Access</th>${FLAGS.map(([, l]) => `<th>${l}</th>`).join('')}<th>Sees</th></tr></thead><tbody>
      ${SECTIONS.map(([s, l]) => { const p = P[s] || {}; return `<tr data-s="${s}"><td><strong>${l}</strong></td><td><select data-k="level" aria-label="${l} access">${[['none','No access'],['view','View'],['edit','Edit']].map(([v, t]) => `<option value="${v}" ${(p.level || 'none') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        ${FLAGS.map(([f, fl]) => `<td><input type="checkbox" data-k="${f}" ${p[f] ? 'checked' : ''} aria-label="${l}: ${fl}"></td>`).join('')}
        <td>${['recruitment','covers'].includes(s) ? `<select data-k="scope" aria-label="${l} scope"><option value="all" ${p.scope !== 'own' ? 'selected' : ''}>All records</option><option value="own" ${p.scope === 'own' ? 'selected' : ''}>Only their own</option></select>` : '—'}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="soft" style="margin:0">Send, bulk send, import, export, delete and manage only work where Access is Edit (export also works with View). "Only their own" shows rows where the Recruiter column matches their name.</p>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="mCancel">Cancel</button><button class="btn pri" id="mSave">Save access</button></div></div>`;
  $('#mCancel').onclick = () => (m.hidden = true);
  $('#mApply').onclick = async () => { const t = $('#mT').value; if (!t) return toast('Pick a template first.', true); try { await callFn('admin-users', { action: 'apply_template', id: u.id, template: t }); toast(`${t} applied.`); m.hidden = true; adminUsers(); } catch (e) { toast(e.message, true); } };
  $('#mSave').onclick = async () => {
    const rows = $$('tr[data-s]', m).map((tr) => { const r = { user_id: u.id, section: tr.dataset.s }; $$('[data-k]', tr).forEach((el) => (r[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value)); return r; });
    const [a, b] = await Promise.all([sb.from('permissions').upsert(rows), sb.from('profiles').update({ full_name: $('#mName').value, team: $('#mTeam').value || null, role: $('#mRole').value, recruiter_name: $('#mRec').value || null, phone: $('#mPhone').value || null }).eq('id', u.id)]);
    const err = a.error || b.error; toast(err ? err.message : 'Access saved. It applies next time they load a page.', !!err); if (!err) { m.hidden = true; adminUsers(); }
  };
}
async function adminTemplates() {
  const { data: tpl } = await sb.from('role_templates').select('*').order('name');
  $('#aBody').innerHTML = `<p class="muted">Templates are starting points. Applying one to a person sets all their access in one click; you can still fine-tune after.</p>
    <div class="charts">${tpl.map((t) => `<section class="card" data-t="${esc(t.name)}"><h2>${esc(t.name)}</h2><p class="muted" style="margin:4px 0 8px">${esc(t.description || '')}</p>
      <div class="list">${SECTIONS.filter(([s]) => t.perms[s]).map(([s, l]) => { const p = t.perms[s]; return `<div><span>${l}</span><b>${p.level}${FLAGS.filter(([f]) => p[f]).map(([, fl]) => ' · ' + fl.toLowerCase()).join('')}${p.scope === 'own' ? ' · own only' : ''}</b></div>`; }).join('')}</div>
      <details><summary class="soft" style="cursor:pointer;margin-top:8px">Edit</summary><textarea data-j style="min-height:180px;margin-top:8px">${esc(JSON.stringify(t.perms, null, 2))}</textarea><button class="btn sm pri" data-save style="margin-top:8px">Save template</button></details></section>`).join('')}
    <section class="card"><h2>New template</h2><label class="f">Name<input id="ntN"></label><label class="f">Description<input id="ntD"></label><label class="f">Access (JSON, copy from another template)<textarea id="ntJ" style="min-height:140px">{ "home": { "level": "view" } }</textarea></label><button class="btn pri" id="ntS">Create template</button></section></div>`;
  $$('[data-save]').forEach((b) => (b.onclick = async () => { const c = b.closest('[data-t]'); let perms; try { perms = JSON.parse($('[data-j]', c).value); } catch (_) { return toast('That JSON has a mistake (check commas and brackets).', true); } const { error } = await sb.from('role_templates').update({ perms }).eq('name', c.dataset.t); toast(error ? error.message : 'Template saved.', !!error); }));
  $('#ntS').onclick = async () => { let perms; try { perms = JSON.parse($('#ntJ').value); } catch (_) { return toast('That JSON has a mistake.', true); } const { error } = await sb.from('role_templates').insert({ name: $('#ntN').value, description: $('#ntD').value, perms }); toast(error ? error.message : 'Template created.', !!error); if (!error) adminTemplates(); };
}
async function adminLog() {
  $('#aBody').innerHTML = `<div class="row"><label class="f">Area<select id="lT"><option value="">Everything</option>${['hires','covers','contracts','users'].map((t) => `<option>${t}</option>`).join('')}</select></label><label class="f">Person<input id="lP" placeholder="Name"></label></div><div class="tablewrap" id="lW" style="margin-top:12px">Loading…</div>`;
  const load = async () => {
    let q = sb.from('activity_feed').select('*').order('at', { ascending: false }).limit(300);
    if ($('#lT').value) q = q.eq('table_name', $('#lT').value);
    if ($('#lP').value) q = q.ilike('full_name', `%${$('#lP').value}%`);
    const { data, error } = await q; if (error) return ($('#lW').textContent = error.message);
    const what = (r) => { const d = r.details || {}; if (r.action === 'UPDATE' && d.before && d.after) return Object.keys(d.after).filter((k) => !['updated_at'].includes(k) && JSON.stringify(d.before[k]) !== JSON.stringify(d.after[k])).map((k) => `${k}: ${d.before[k] ?? '—'} → ${d.after[k] ?? '—'}`).join('; '); return d.site || d.name || d.email || ''; };
    $('#lW').innerHTML = `<table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Area</th><th>Details</th></tr></thead><tbody>${(data || []).map((r) => `<tr><td class="mono">${new Date(r.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(r.full_name || 'System')}</td><td>${esc(r.action.toLowerCase())}</td><td>${esc(r.table_name)}</td><td style="max-width:520px">${esc(what(r)).slice(0, 300)}</td></tr>`).join('')}</tbody></table>`;
  };
  $('#lT').onchange = load; $('#lP').onchange = load; load();
}
async function adminEmail() {
  const { data: tps } = await sb.from('email_templates').select('*').order('key');
  $('#aBody').innerHTML = `<div style="display:flex;flex-direction:column;gap:18px"><section class="card"><h2>Always CC</h2><div class="row" style="margin-top:12px;align-items:stretch">
      <label class="f" style="flex:1">Cleaner emails (one per line)<textarea id="ccClean" style="min-height:110px">${esc((S.settings.cleaner_cc || []).join('\n'))}</textarea></label>
      <label class="f" style="flex:1">Client emails<textarea id="ccClient" style="min-height:110px">${esc((S.settings.client_cc || []).join('\n'))}</textarea></label>
      <label class="f" style="flex:1">Recruiter names<textarea id="recs" style="min-height:110px">${esc((S.settings.recruiters || []).join('\n'))}</textarea></label></div>
      <button class="btn pri" id="saveSet" style="margin-top:10px">Save</button></section>
    ${(tps || []).map((t) => `<section class="card" data-tk="${esc(t.key)}"><h2>${{ cover_cleaner: 'Cover email to cleaner', cover_client: 'Cover email to client', hire_cleaner: 'New starter email' }[t.key] || esc(t.key)}</h2><p class="soft" style="margin:4px 0">Placeholders: {{site}} {{address}} {{cleaner}} {{dates}} {{shift}} {{rate}} {{absent_first}} {{dbs_number}} {{start_date}} {{training_link}} {{sender_name}}</p>
      <label class="f">Subject<input data-sub value="${esc(t.subject)}"></label><label class="f">Body<textarea data-body style="min-height:260px">${esc(t.body)}</textarea></label><button class="btn pri" data-st style="margin-top:8px">Save template</button></section>`).join('')}</div>`;
  $('#saveSet').onclick = async () => {
    const lines = (id) => $(id).value.split('\n').map((x) => x.trim()).filter(Boolean);
    const up = [['cleaner_cc', lines('#ccClean')], ['client_cc', lines('#ccClient')], ['recruiters', lines('#recs')]].map(([key, value]) => ({ key, value }));
    const { error } = await sb.from('settings').upsert(up); if (error) toast(error.message, true); else { up.forEach((u) => (S.settings[u.key] = u.value)); toast('Saved.'); }
  };
  $$('[data-st]').forEach((b) => (b.onclick = async () => { const c = b.closest('[data-tk]'); const { error } = await sb.from('email_templates').update({ subject: $('[data-sub]', c).value, body: $('[data-body]', c).value }).eq('key', c.dataset.tk); toast(error ? error.message : 'Template saved.', !!error); }));
}
async function adminReview() {
  const { data: rv } = await sb.from('import_review').select('*').eq('resolved', false).order('id').limit(500);
  $('#aBody').innerHTML = `<div class="tablewrap"><table><thead><tr><th>Sheet</th><th>Row</th><th>Field</th><th>Value</th><th>Issue</th><th></th></tr></thead><tbody>${(rv || []).map((r) => `<tr><td>${esc(r.sheet)}</td><td>${r.excel_row}</td><td>${esc(r.field)}</td><td>${esc(r.value)}</td><td>${esc(r.issue)}</td><td><button class="btn sm" data-res="${r.id}">Mark fixed</button></td></tr>`).join('')}</tbody></table><div class="pager">Showing up to 500 open items</div></div>`;
  $$('[data-res]').forEach((b) => (b.onclick = async () => { await sb.from('import_review').update({ resolved: true }).eq('id', b.dataset.res); b.closest('tr').remove(); }));
}

/* ---------- drill-down, exports, reports ---------- */
S.drills = {};
const dset = (key, title, rows, cols) => { S.drills[key] = { title, rows, cols }; return `data-drill="${key}" role="button" tabindex="0"`; };
const cellText = (v) => v == null ? '' : typeof v === 'number' ? v : String(v);
function exportRows(name, rows, cols, kind = 'xlsx') {
  if (!rows.length) return toast('Nothing to export.', true);
  const data = rows.map((r) => Object.fromEntries(cols.map(([k, l, f]) => [l, cellText(f ? f(r) : r[k])])));
  if (kind === 'csv' || !window.XLSX) return downloadCsv(name + '.csv', data);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), name.slice(0, 31)); XLSX.writeFile(wb, name + '.xlsx');
}
function drill(key) {
  const d = S.drills[key]; if (!d) return;
  const m = $('#modal'); m.hidden = false;
  const canX = isAdmin() || Object.values(S.perms).some((p) => p.can_export);
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="${esc(d.title)}" style="width:min(1200px,100%)">
    <div class="head" style="padding-bottom:12px"><div><div class="soft">Details</div><h1 style="font-size:19px">${esc(d.title)}</h1></div><div class="row"><input id="dq" placeholder="Filter rows" aria-label="Filter rows">${canX ? '<button class="btn" id="dX">Excel</button><button class="btn" id="dC">CSV</button>' : ''}<button class="btn" id="dAI">✨ Explain</button><button class="btn" id="dP">Print</button><button class="btn pri" id="dClose">Close</button></div></div>
    <div class="tablewrap" style="max-height:60vh"><table><thead><tr>${d.cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody id="dB"></tbody></table></div><div class="soft" id="dN"></div></div>`;
  const draw = () => { const q = $('#dq').value.toLowerCase(); const rows = d.rows.filter((r) => !q || d.cols.some(([k, , f]) => String(f ? f(r) : r[k] ?? '').toLowerCase().includes(q)));
    $('#dB').innerHTML = rows.slice(0, 1000).map((r) => `<tr>${d.cols.map(([k, , f]) => `<td>${esc(cellText(f ? f(r) : r[k]))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${d.cols.length}" class="muted" style="padding:18px">No rows.</td></tr>`;
    $('#dN').textContent = `${rows.length} row${rows.length === 1 ? '' : 's'}${rows.length > 1000 ? ' (showing first 1,000 – export for all)' : ''}`; return rows; };
  let cur = draw(); $('#dq').oninput = () => (cur = draw());
  if ($('#dX')) { $('#dX').onclick = () => exportRows(d.title.replace(/[^\w ]+/g, '').trim(), cur, d.cols); $('#dC').onclick = () => exportRows(d.title.replace(/[^\w ]+/g, '').trim(), cur, d.cols, 'csv'); }
  $('#dP').onclick = () => { const w = window.open('', '_blank'); w.document.write(`<title>${esc(d.title)}</title><style>body{font:12px system-ui;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}</style><h2>${esc(d.title)}</h2><p>Crystal FM · ${new Date().toLocaleString('en-GB')}</p><table><tr>${d.cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr>${cur.map((r) => `<tr>${d.cols.map(([k, , f]) => `<td>${esc(cellText(f ? f(r) : r[k]))}</td>`).join('')}</tr>`).join('')}</table>`); w.document.close(); w.print(); };
  $('#dClose').onclick = () => (m.hidden = true);
  $('#dAI').onclick = () => { m.hidden = true; aiAsk(`Explain "${d.title}" (${d.rows.length} rows): what does it show, what stands out, and what needs my attention?`); };
}
document.addEventListener('click', (e) => { const el = e.target.closest('[data-drill]'); if (el && !e.target.closest('button,a,input,select')) drill(el.dataset.drill); });
document.addEventListener('keydown', (e) => { const el = e.target.closest && e.target.closest('[data-drill]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); drill(el.dataset.drill); } });
// Whole-dashboard report: every drill set becomes a sheet
function downloadReport(name, summary) {
  if (!window.XLSX) return toast('Excel library not loaded.', true);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
  const used = new Set(['Summary']);
  Object.values(S.drills).forEach((d) => { let n = d.title.replace(/[\\/?*[\]:]/g, '').slice(0, 28); while (used.has(n)) n = n.slice(0, 26) + used.size; used.add(n);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.rows.map((r) => Object.fromEntries(d.cols.map(([k, l, f]) => [l, cellText(f ? f(r) : r[k])])))), n); });
  XLSX.writeFile(wb, `${name} ${new Date().toISOString().slice(0, 10)}.xlsx`);
}
const reportBar = (id) => `<div class="row"><button class="btn" id="${id}X">${ICON('<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/>')}Download report</button><button class="btn" onclick="window.print()">${ICON('<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>')}Print</button></div>`;
const COLS = {
  cover: [['date_from', 'From'], ['date_to', 'To'], ['site', 'Site'], ['kind', 'Type'], ['absent_cleaner', 'Absent'], ['cover_cleaner', 'Cover cleaner'], ['recruiter', 'Recruiter'], ['reason', 'Reason'], ['client_email_status', 'Client email']],
  hire: [['raised_on', 'Raised'], ['site', 'Site'], ['role', 'Role'], ['recruiter', 'Recruiter'], ['status', 'Status'], ['start_date', 'Start'], ['candidate', 'Candidate'], ['days', 'Days open', (r) => r.raised_on ? Math.round((Date.now() - new Date(r.raised_on)) / 864e5) : '']],
};

/* ---------- data hub: import & export ---------- */
const DATASETS = [
  ['hires', 'New hiring', 'recruitment', ['raised_on','contract','site','area_manager','rate','dbs','role','headcount','hire_type','recruiter','status','start_date','candidate','candidate_email','candidate_phone','notes']],
  ['covers', 'Covers', 'covers', ['kind','date_from','date_to','contract','site','absent_cleaner','cover_cleaner','cover_email','shift','rate','dbs','dbs_number','dbs_issue_date','reason','recruiter','status','notes']],
  ['contracts', 'Contracts', 'contracts', ['name','ref','sector','region','start_date','end_date','year1_rate','year2_rate','uplift_pct','monthly_value','monthly_value_y2','weekly_hours','target_margin_pct','area_manager','account_manager','ccm','audit_schedule','postcode']],
  ['sites', 'Sites', 'contracts', ['contract_id','name','address','city','region','postcode','am_email','ccm_email','active']],
  ['client_contacts', 'Client contacts', 'contracts', ['site_id','name','email','role']],
  ['pl_entries', 'P&L', 'finance', ['contract_id','month','revenue','invoiced_hours','labour_cost','labour_hours','materials','other_costs','notes']],
  ['inductions', 'Inductions', 'recruitment', ['starter','site','induction_date','trainer','hours','status','notes']],
  ['dbs_checks', 'DBS checks', 'recruitment', ['person','recruiter','applied_on','level','status','issued_on','dbs_number','cost']],
];
async function pageData() {
  const vis = DATASETS.filter(([, , sec]) => can(sec));
  shell(`<div class="head"><div><div class="soft">Data</div><h1>Import and export</h1><p class="muted" style="margin:2px 0 0">Download any dataset to Excel or CSV, or upload a spreadsheet to add or update records.</p></div></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${vis.map(([t, l, sec]) => `<section class="card" style="display:flex;flex-direction:column;gap:10px"><h2>${ICON(I.doc)} ${l}</h2><p class="soft" style="margin:0" id="cnt-${t}">Counting…</p>
      <div class="row">${canFlag(sec, 'can_export') ? `<button class="btn sm" data-ex="${t}" data-k="xlsx">Export Excel</button><button class="btn sm" data-ex="${t}" data-k="csv">Export CSV</button>` : ''}${canFlag(sec, 'can_import') && can(sec, 'edit') ? `<button class="btn sm pri" data-im="${t}">Import</button>` : ''}</div>
      ${!canFlag(sec, 'can_export') && !canFlag(sec, 'can_import') ? '<span class="soft">View only. Ask Syed for import or export rights.</span>' : ''}</section>`).join('') || '<p class="muted">You have no datasets.</p>'}</div>
    ${trackerBtn() ? `<section class="card" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:260px"><h2 style="border:none;padding:0;margin:0">Recruitment Tracker (Excel)</h2><p class="muted" style="margin:4px 0 0" id="tkLast">Upload the latest tracker to update New Hiring and Covers without duplicates.</p></div>${trackerBtn()}</section>` : ''}
    <div id="imBox"></div>`);
  sb.from('settings').select('value').eq('key', 'tracker_sync').maybeSingle().then(({ data }) => { const v = data?.value; if (v && $('#tkLast')) $('#tkLast').textContent = `Last synced ${new Date(v.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} by ${v.by} from ${v.file}: ${v.new} new, ${v.updated} updated.`; });
  vis.forEach(async ([t]) => { const { count } = await sb.from(t).select('*', { count: 'exact', head: true }); const el = $('#cnt-' + t); if (el) el.textContent = `${fmtN(count || 0)} records`; });
  $$('[data-ex]').forEach((b) => (b.onclick = async () => { b.disabled = true; const [t, l, , cols] = DATASETS.find((d) => d[0] === b.dataset.ex); const rows = await fetchAll(t, '*'); exportRows(`${l} ${new Date().toISOString().slice(0, 10)}`, rows, [['id', 'id'], ...cols.map((c) => [c, c])], b.dataset.k); b.disabled = false; }));
  $$('[data-im]').forEach((b) => (b.onclick = () => importWizard(DATASETS.find((d) => d[0] === b.dataset.im))));
}
function importWizard([t, label, sec, cols]) {
  const box = $('#imBox');
  box.innerHTML = `<section class="card" style="display:flex;flex-direction:column;gap:12px"><h2>Import into ${label}</h2>
    <p class="muted" style="margin:0">Tip: export first, edit in Excel, and import back. Rows <b>with an id</b> update the existing record; rows without one are added as new.</p>
    <div class="row"><input type="file" id="iwF" accept=".xlsx,.xls,.csv"><button class="btn" id="iwT">Download blank template</button></div><div id="iwM"></div><div id="iwP"></div></section>`;
  box.scrollIntoView({ behavior: 'smooth' });
  $('#iwT').onclick = () => exportRows(`${label} template`, [Object.fromEntries(cols.map((c) => [c, '']))], cols.map((c) => [c, c]));
  $('#iwF').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    let wb; try { wb = XLSX.read(await f.arrayBuffer(), { cellDates: true }); } catch (er) { return toast("Couldn't read that file: " + er.message, true); }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!rows.length) return toast('No rows found in the first sheet.', true);
    const fileCols = Object.keys(rows[0]), norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = ['id', ...cols];
    $('#iwM').innerHTML = `<p class="soft" style="margin:0 0 6px">${rows.length} rows. Match your columns (auto-matched where names are the same):</p><div class="row">${target.map((c) => `<label class="f">${c}<select data-c="${c}"><option value="">— skip —</option>${fileCols.map((fc) => `<option ${norm(fc) === norm(c) ? 'selected' : ''}>${esc(fc)}</option>`).join('')}</select></label>`).join('')}</div><button class="btn pri" id="iwGo" style="margin-top:10px">Preview</button>`;
    $('#iwGo').onclick = () => {
      const M = Object.fromEntries($$('[data-c]').map((s) => [s.dataset.c, s.value]).filter(([, v]) => v));
      const val = (v) => v instanceof Date ? new Date(v.getTime() + 12 * 36e5).toISOString().slice(0, 10) : (v === '' ? null : v);
      const out = rows.map((r) => Object.fromEntries(Object.entries(M).map(([c, fc]) => [c, val(r[fc])]))).filter((r) => Object.values(r).some((v) => v != null));
      const upd = out.filter((r) => r.id), add = out.filter((r) => !r.id).map(({ id, ...x }) => x);
      $('#iwP').innerHTML = `<p><b>${add.length}</b> new rows and <b>${upd.length}</b> updates.</p><div class="tablewrap" style="max-height:300px"><table><thead><tr>${Object.keys(M).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${out.slice(0, 50).map((r) => `<tr>${Object.keys(M).map((c) => `<td>${esc(cellText(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div><button class="btn pri" id="iwSave" style="margin-top:10px">Import now</button>`;
      $('#iwSave').onclick = async () => {
        $('#iwSave').disabled = true;
        for (let i = 0; i < add.length; i += 300) { const { error } = await sb.from(t).insert(add.slice(i, i + 300)); if (error) { $('#iwSave').disabled = false; return toast('Stopped: ' + error.message, true); } }
        for (let i = 0; i < upd.length; i += 300) { const { error } = await sb.from(t).upsert(upd.slice(i, i + 300)); if (error) { $('#iwSave').disabled = false; return toast('Stopped: ' + error.message, true); } }
        toast(`Imported ${add.length} new and ${upd.length} updated rows into ${label}.`); pageData();
      };
    };
  };
}

/* ---------- Crystal AI: chat widget, insights, admin ---------- */
const AI = { msgs: [], status: null };
async function aiStatus() { if (AI.status) return AI.status; try { AI.status = await callFn('ai', { action: 'status' }); } catch (_) { AI.status = { connected: false, error: true }; } return AI.status; }
function mountAI() {
  if ($('#aiFab') || !S.profile) return;
  document.body.insertAdjacentHTML('beforeend', `<button class="aifab" id="aiFab" aria-label="Ask Crystal AI">${ICON('<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z"/>')}<span>Ask AI</span></button>
    <section class="aipanel" id="aiPanel" hidden aria-label="Crystal AI"><header><div style="display:flex;gap:10px;align-items:center"><div class="aiorb"></div><div><b>Crystal AI</b><div class="soft" id="aiSt" style="font-size:11.5px">Checking connection…</div></div></div><button class="iconbtn" id="aiX" aria-label="Close" style="color:var(--soft)">✕</button></header>
    <div class="aimsgs" id="aiMsgs" aria-live="polite"></div><div class="aisugg" id="aiSugg"></div>
    <form id="aiForm"><textarea id="aiIn" rows="1" placeholder="Ask about covers, vacancies, P&L…" aria-label="Message"></textarea><button class="btn pri" aria-label="Send">${ICON('<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>')}</button></form></section>`);
  $('#aiFab').onclick = openAI; $('#aiX').onclick = () => ($('#aiPanel').hidden = true);
  $('#aiIn').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aiForm').requestSubmit(); } };
  $('#aiForm').onsubmit = (e) => { e.preventDefault(); const q = $('#aiIn').value.trim(); if (q) { $('#aiIn').value = ''; askAI(q); } };
}
async function openAI() {
  $('#aiPanel').hidden = false; $('#aiIn').focus();
  const st = await aiStatus();
  $('#aiSt').innerHTML = st.connected ? `<span style="color:var(--filled)">●</span> Live · ${esc(st.provider)} · watching your data` : '<span style="color:var(--prog)">●</span> Not connected yet';
  if (AI.msgs.length) { $('#aiSugg').innerHTML = ['Summarise this page', 'What needs my attention on this page?', '✨ Insights for this page'].map((s2) => `<button type="button">${s2}</button>`).join(''); $$('#aiSugg button').forEach((b) => (b.onclick = () => (b.textContent.startsWith('✨') ? (($('#aiSugg').innerHTML = ''), aiInsightsPanel()) : askAI(b.textContent)))); }
  if (!AI.msgs.length) {
    $('#aiMsgs').innerHTML = `<div class="aim bot">Hi ${esc(S.profile.full_name.split(' ')[0])}. I can read the live portal data you have access to and answer questions, spot problems and draft actions.${st.connected ? '' : `<br><br><b>AI isn't connected yet.</b> ${isAdmin() ? 'Go to Admin → AI to connect your API key.' : 'Ask Syed to connect it.'}`}</div>`;
    const sug = ['Summarise this page', 'What needs my attention on this page?', '✨ Insights for this page', 'Which sites need the most covers this month?', 'Any missed covers I should act on?', 'Which vacancies have been open longest?', ...(can('finance') ? ['Which contracts lost money last month and why?'] : []), 'Give me a 5-line summary for my boss'];
    $('#aiSugg').innerHTML = sug.map((s) => `<button type="button">${esc(s)}</button>`).join('');
    $$('#aiSugg button').forEach((b) => (b.onclick = () => (b.textContent.startsWith('✨') ? (($('#aiSugg').innerHTML = ''), aiInsightsPanel()) : askAI(b.textContent))));
  }
}
const mdLite = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-•] (.*)$/gm, '<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`).replace(/\n/g, '<br>');
async function askAI(q) {
  $('#aiSugg').innerHTML = '';
  AI.msgs.push({ role: 'user', content: q });
  $('#aiMsgs').insertAdjacentHTML('beforeend', `<div class="aim me">${esc(q)}</div><div class="aim bot typing" id="aiT"><span></span><span></span><span></span></div>`);
  $('#aiMsgs').scrollTop = 1e9;
  try { const r = await callFn('ai', { action: 'chat', messages: AI.msgs, page: location.hash, page_data: pageCtx() }); AI.msgs.push({ role: 'assistant', content: r.answer }); $('#aiT').outerHTML = `<div class="aim bot">${mdLite(r.answer)}</div>`; }
  catch (e) { AI.msgs.pop(); $('#aiT').outerHTML = `<div class="aim bot err">${esc(e.message)}</div>`; }
  $('#aiMsgs').scrollTop = 1e9;
}
async function aiInsightsCard() {
  const { data, error } = await sb.from('ai_insights').select('*').eq('dismissed', false).order('created_at', { ascending: false }).limit(5);
  const box = $('#aiIns'); if (!box) return;
  if (error) { box.remove(); return; }
  const st = await aiStatus();
  const SEV = { high: '--danger', medium: '--prog', low: '--planned' };
  box.innerHTML = `<h2>${ICON('<path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/>')} AI insights <span class="chip" style="--c:var(${st.connected ? '--filled' : '--hold'});margin-left:auto">${st.connected ? 'Monitoring live' : 'AI not connected'}</span></h2>
    ${data?.length ? `<div class="list">${data.map((x) => `<div><span><span class="chip" style="--c:var(${SEV[x.severity] || '--hold'})">${x.severity}</span> <b style="margin-left:6px">${esc(x.title)}</b><br><span class="soft">${esc(x.detail || '')}</span></span><span style="display:flex;gap:6px">${x.link ? `<a class="btn sm" href="${esc(x.link)}">Open</a>` : ''}<button class="btn sm" data-dis="${x.id}">Dismiss</button></span></div>`).join('')}</div>` : `<p class="muted" style="margin:0">${st.connected ? 'No issues flagged right now.' : 'Once AI is connected, it checks your covers, vacancies, P&L and safeguarding every hour and flags what needs action here.'}</p>`}`;
  $$('[data-dis]').forEach((b) => (b.onclick = async () => { await sb.from('ai_insights').update({ dismissed: true }).eq('id', b.dataset.dis); aiInsightsCard(); }));
}
async function adminAI() {
  const st = await aiStatus(); const cfg = S.settings.ai || { chat_enabled: true, monitor_enabled: true, instructions: '' };
  $('#aBody').innerHTML = `<div class="charts"><section class="card" style="display:flex;flex-direction:column;gap:12px"><h2>Connection</h2>
      <div class="list"><div><span>Status</span><b style="color:var(${st.connected ? '--filled' : '--prog'})">${st.connected ? 'Connected' : 'Not connected'}</b></div><div><span>Provider</span><b>${esc(st.provider || '—')}</b></div><div><span>Model</span><b>${esc(st.model || '—')}</b></div></div>
      <p class="muted" style="margin:0">Your API key is kept in Supabase secrets, never in the website. To connect:</p>
      <ol class="muted" style="margin:0;padding-left:18px;line-height:1.8"><li>Supabase → Edge Functions → Secrets</li><li><code>AI_PROVIDER</code> = anthropic, openai, openrouter or groq</li><li><code>AI_API_KEY</code> = your key</li><li>Optional <code>AI_MODEL</code> to pick a model</li><li>Come back here and click Test</li></ol>
      <div class="row"><button class="btn pri" id="aiTest">Test connection</button>${st.connected ? '<button class="btn" id="aiRun">Run monitoring now</button>' : ''}</div></section>
    <section class="card" style="display:flex;flex-direction:column;gap:12px"><h2>Behaviour</h2>
      <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="aiChat" ${cfg.chat_enabled !== false ? 'checked' : ''}> Chat assistant for everyone with access</label>
      <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="aiMon" ${cfg.monitor_enabled ? 'checked' : ''}> Real-time monitoring (hourly checks, high-risk issues go to the bell)</label>
      <label class="f">Instructions for the AI<textarea id="aiIns2" style="min-height:120px">${esc(cfg.instructions || '')}</textarea></label>
      <button class="btn pri" id="aiSave">Save</button>
      <p class="soft" style="margin:0">The AI only sees data the person asking is allowed to see. Every question is logged.</p></section></div>`;
  $('#aiTest').onclick = async () => { AI.status = null; const s2 = await aiStatus(); if (!s2.connected) return toast('Not connected yet. Add AI_API_KEY in Supabase secrets.', true); try { const r = await callFn('ai', { action: 'chat', messages: [{ role: 'user', content: 'Reply with: Connection OK' }] }); toast('AI says: ' + r.answer.slice(0, 80)); } catch (e) { toast(e.message, true); } adminAI(); };
  if ($('#aiRun')) $('#aiRun').onclick = async () => { try { const r = await callFn('ai', { action: 'run_monitor' }); toast(r.created != null ? `${r.created} insight(s) created.` : 'Monitoring is switched off.'); } catch (e) { toast(e.message, true); } };
  $('#aiSave').onclick = async () => { const value = { chat_enabled: $('#aiChat').checked, monitor_enabled: $('#aiMon').checked, instructions: $('#aiIns2').value }; const { error } = await sb.from('settings').upsert({ key: 'ai', value }); if (!error) { S.settings.ai = value; AI.status = null; } toast(error ? error.message : 'Saved.', !!error); };
}

/* ---------- Sync from the Excel Recruitment Tracker (no duplicates) ---------- */
const tkNorm = (x) => String(x ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '').trim();
function tkDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : new Date(v.getTime() + 12 * 36e5).toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000) return new Date(Math.round((v - 25569) * 864e5)).toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-]?(\d{2,4})$/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const d = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return d >= '2020-01-01' && d <= '2030-12-31' ? d : null; }
  const d = new Date(v); return isNaN(d) || d.getFullYear() < 2020 ? null : d.toISOString().slice(0, 10);
}
const tkNum = (v) => { const n = parseFloat(String(v ?? '').replace(/[£,\s]/g, '')); return isNaN(n) ? null : n; };
const TK_FIX = [['Ormistan', 'Ormiston'], ['St. Olave Grammar School', "St. Olave's Grammar School"], ['Alderly Hey', 'Alder Hey']];
const tkTxt = (v) => { let s2 = String(v ?? '').replace(/\s+/g, ' ').trim(); TK_FIX.forEach(([a, b]) => (s2 = s2.split(a).join(b))); return s2 || null; };
function tkSheet(wb, name) {
  const sn = wb.SheetNames.find((n) => n.trim().toLowerCase() === name.toLowerCase()); if (!sn) return null;
  const g = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: true });
  const h = g.slice(0, 10).findIndex((r) => r.some((c) => /^status$/i.test(String(c).trim())));
  return { rows: g.slice((h < 0 ? 2 : h) + 1), header: g[h < 0 ? 2 : h] || [] };
}
function parseTracker(wb) {
  const STAFF = new Set((S.settings.recruiters || []).map((r) => r.toLowerCase()));
  const siteId = (n) => { const k = tkNorm(n); if (!k) return null; const hit = S.sites.find((x) => tkNorm(x.name) === k); return hit ? hit.id : null; };
  const occ = new Map(), key = (base) => { const n = (occ.get(base) || 0) + 1; occ.set(base, n); return n > 1 ? `${base}#${n}` : base; };
  const out = { hires: [], covers: [] };
  const H = tkSheet(wb, 'New Hiring');
  if (H) {
    const si = H.header.findIndex((c) => /^status$/i.test(String(c).trim()));
    const ST = { filled: 'Filled', vacant: 'Vacant', offer: 'Offer', 'in progress': 'In Progress', 'on hold': 'On Hold' };
    H.rows.forEach((r) => {
      if (!tkTxt(r[1]) && !tkTxt(r[2])) return;
      const raised = tkDate(r[0]), site = tkTxt(r[2]), role = tkTxt(r[7]);
      out.hires.push({ tracker_key: key(`H|${raised}|${tkNorm(site)}|${tkNorm(role)}`), source: 'tracker', raised_on: raised, contract: tkTxt(r[1]), site, site_id: siteId(site), area_manager: String(r[4]).startsWith('=') ? null : tkTxt(r[4]), rate: tkNum(r[5]), dbs: tkTxt(r[6]), role, headcount: Number.isInteger(+r[8]) && +r[8] > 0 ? +r[8] : 1, recruiter: tkTxt(r[9]), status: ST[String(r[si >= 0 ? si : 10] || '').trim().toLowerCase()] || null, start_date: tkDate(r[11]), candidate: tkTxt(r[12]), notes: tkTxt(r[13]), hire_type: 'Permanent' });
    });
  }
  [['Planned Covers', 'Planned'], ['Unplanned Covers', 'Unplanned']].forEach(([sn, kind]) => {
    const C = tkSheet(wb, sn); if (!C) return;
    C.rows.forEach((r) => {
      if (!tkTxt(r[3]) && !tkTxt(r[4]) && !tkTxt(r[8])) return;
      const df = tkDate(r[0]), dt = tkDate(r[1]), site = tkTxt(r[3]), absent = tkTxt(r[4]), rec = tkTxt(r[10]);
      out.covers.push({ tracker_key: key(`C|${kind}|${df}|${dt}|${tkNorm(site)}|${tkNorm(absent)}`), source: 'tracker', kind, date_from: df, date_to: dt, contract: tkTxt(r[2]), site, site_id: siteId(site), absent_cleaner: absent, shift: tkTxt(r[5]), rate: tkNum(r[6]), dbs: tkTxt(r[7]), cover_cleaner: tkTxt(r[8]), reason: tkTxt(r[9]), recruiter: rec && STAFF.has(rec.toLowerCase()) ? rec : null, status: tkTxt(r[11]), notes: tkTxt(r[14]) });
    });
  });
  return out;
}
async function trackerSync() {
  const m = $('#modal'); m.hidden = false;
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Sync from tracker"><h2>Sync from the Recruitment Tracker</h2>
    <p class="muted" style="margin:0">Upload the latest <b>Recruitment Tracker</b> Excel (download it from SharePoint: File → Save a copy / Download). New rows are added, changed rows are updated, nothing is duplicated, and email statuses already set in the portal are kept.</p>
    <input type="file" id="tkF" accept=".xlsx,.xlsm,.xls"><div id="tkP"></div><div class="row" style="justify-content:flex-end"><button class="btn" id="tkC">Close</button></div></div>`;
  $('#tkC').onclick = () => (m.hidden = true);
  $('#tkF').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#tkP').innerHTML = SKEL;
    let wb; try { wb = XLSX.read(await f.arrayBuffer(), { cellDates: true }); } catch (er) { $('#tkP').innerHTML = `<p class="err">Couldn't read that file: ${esc(er.message)}</p>`; return; }
    const T = parseTracker(wb);
    if (!T.hires.length && !T.covers.length) { $('#tkP').innerHTML = '<p class="err">No New Hiring or Covers sheets found in that file.</p>'; return; }
    // Match existing rows: by tracker key, or (first sync) by date+site+name, also trying day/month swapped
    const [eh, ec] = await Promise.all([fetchAll('hires', 'id,tracker_key,raised_on,site,role'), fetchAll('covers', 'id,tracker_key,kind,date_from,date_to,site,absent_cleaner')]);
    const swap = (d) => { if (!d) return d; const [y, mo, da] = d.split('-'); return +da <= 12 && da !== mo ? `${y}-${da}-${mo}` : d; };
    const pool = (rows, mk) => { const m2 = new Map(); rows.filter((r) => !r.tracker_key).forEach((r) => { const ks = new Set([mk(r, false), mk(r, true)]); ks.forEach((k) => { if (!m2.has(k)) m2.set(k, []); m2.get(k).push(r.id); }); }); return m2; };
    const PH = pool(eh, (r, sw) => `H|${sw ? swap(r.raised_on) : r.raised_on}|${tkNorm(r.site)}|${tkNorm(r.role)}`);
    const PC = pool(ec, (r, sw) => `C|${r.kind}|${sw ? swap(r.date_from) : r.date_from}|${sw ? swap(r.date_to) : r.date_to}|${tkNorm(r.site)}|${tkNorm(r.absent_cleaner)}`);
    const used = new Set(), keyedH = new Set(eh.map((r) => r.tracker_key).filter(Boolean)), keyedC = new Set(ec.map((r) => r.tracker_key).filter(Boolean));
    const classify = (rows, keyed, P) => { const upd = [], byId = [], add = []; rows.forEach((r) => { if (keyed.has(r.tracker_key)) return upd.push(r); const ids = (P.get(r.tracker_key.split('#')[0]) || []).filter((id) => !used.has(id)); if (ids.length) { used.add(ids[0]); return byId.push({ ...r, id: ids[0] }); } add.push(r); }); return [upd, byId, add]; };
    const [updH0, idH, newH] = classify(T.hires, keyedH, PH), [updC0, idC, newC] = classify(T.covers, keyedC, PC);
    const updH = [...updH0, ...idH], updC = [...updC0, ...idC];
    const fixedDates = [...idH.filter((r) => !eh.some((x) => x.id === r.id && x.raised_on === r.raised_on)), ...idC.filter((r) => !ec.some((x) => x.id === r.id && x.date_from === r.date_from))].length;
    const inFile = new Set([...T.hires, ...T.covers].map((r) => r.tracker_key));
    const goneC = ec.filter((r) => r.tracker_key && r.tracker_key.startsWith('C|') && !inFile.has(r.tracker_key)).length;
    const noSite = [...T.hires, ...T.covers].filter((r) => r.site && !r.site_id).length;
    const today = new Date().toISOString().slice(0, 10);
    $('#tkP').innerHTML = `<section class="grid">${[['New vacancies', newH.length, '--filled'], ['Vacancies updated', updH.length, '--planned'], ['New covers', newC.length, '--filled'], ['Covers updated', updC.length, '--planned']].map(([l, v, c]) => `<div class="card kpi" style="--c:var(${c})"><span>${l}</span><b>${fmtN(v)}</b></div>`).join('')}</section>
      <p class="soft" style="margin:0">${fixedDates ? `<b>${fixedDates} dates will be corrected</b> (the first import read some dates as month/day). ` : ''}${noSite ? `${noSite} rows have a site name not in Contracts (they still import; fix names later). ` : ''}${goneC ? `${goneC} covers from earlier syncs are no longer in this file; they are left untouched.` : ''}</p>
      <div class="row" style="justify-content:flex-end"><button class="btn pri" id="tkGo">Sync ${fmtN(newH.length + newC.length)} new and ${fmtN(updH.length + updC.length)} updated rows</button></div>`;
    $('#tkGo').onclick = async () => {
      const b = $('#tkGo'); b.disabled = true;
      const step = async (label, fn) => { b.textContent = label; const { error } = await fn(); if (error) throw new Error(`${label}: ${error.message}${/tracker_key|source/.test(error.message) ? ' (run phase10-tracker-sync.sql)' : ''}`); };
      const chunks = (arr, n = 300) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
      try {
        for (const c of chunks(idH)) await step('Matching vacancies…', () => sb.from('hires').upsert(c, { onConflict: 'id' }));
        for (const c of chunks(idC)) await step('Matching covers…', () => sb.from('covers').upsert(c, { onConflict: 'id' }));
        for (const c of chunks(updH0)) await step('Updating vacancies…', () => sb.from('hires').upsert(c, { onConflict: 'tracker_key' }));
        for (const c of chunks(newH)) await step('Adding vacancies…', () => sb.from('hires').upsert(c, { onConflict: 'tracker_key' }));
        for (const c of chunks(updC0)) await step('Updating covers…', () => sb.from('covers').upsert(c, { onConflict: 'tracker_key' }));
        for (const c of chunks(newC.map((r) => ({ ...r, cleaner_email_status: (r.date_from || today) < today ? 'Historic' : 'Not sent', client_email_status: (r.date_from || today) < today ? 'Historic' : 'Pending' })))) await step('Adding covers…', () => sb.from('covers').upsert(c, { onConflict: 'tracker_key' }));
        await sb.from('settings').upsert({ key: 'tracker_sync', value: { at: new Date().toISOString(), by: S.profile.full_name, file: f.name, new: newH.length + newC.length, updated: updH.length + updC.length } });
        m.hidden = true; toast(`Tracker synced: ${newH.length + newC.length} new, ${updH.length + updC.length} updated.`); route();
      } catch (er) { toast(er.message, true); b.disabled = false; b.textContent = 'Try again'; }
    };
  };
}
const trackerBtn = () => (isAdmin() || canFlag('recruitment', 'can_import') || canFlag('covers', 'can_import')) ? `<button class="btn" data-tk>${ICON('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>')}Sync from tracker</button>` : '';
document.addEventListener('click', (e) => { if (e.target.closest('[data-tk]')) trackerSync(); });

/* =====================================================================
   PHASES 2–5
   ===================================================================== */

/* ---------- P2: tables everywhere get sorting, column picker and saved views ---------- */
const tableKey = (t) => location.hash.split('?')[0] + '|' + [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim()).join('|').slice(0, 80);
function enhanceTable(table) {
  if (table._enh || !table.tHead || table.closest('.modal') && table.closest('.cmdk')) return; table._enh = true;
  const key = tableKey(table), ths = [...table.tHead.rows[0].cells];
  let hidden = []; try { hidden = JSON.parse(localStorage.getItem('cols:' + key) || '[]'); } catch (_) {}
  const applyCols = () => { ths.forEach((th, i) => { const h = hidden.includes(i); th.style.display = h ? 'none' : ''; [...table.tBodies[0]?.rows || []].forEach((r) => { if (r.cells[i]) r.cells[i].style.display = h ? 'none' : ''; }); }); };
  ths.forEach((th, i) => {
    if (!th.textContent.trim() || th.querySelector('input')) return;
    th.style.cursor = 'pointer'; th.title = 'Sort'; th.tabIndex = 0;
    const sortNow = () => {
      const dir = th.dataset.sort === 'asc' ? 'desc' : 'asc'; ths.forEach((x) => { delete x.dataset.sort; x.querySelector('.sarr')?.remove(); });
      th.dataset.sort = dir; th.insertAdjacentHTML('beforeend', `<span class="sarr">${dir === 'asc' ? ' ▲' : ' ▼'}</span>`);
      const val = (r) => { const c = r.cells[i]; if (!c) return ''; const el = c.querySelector('input,select'); const v = (el ? el.value : c.textContent).trim(); const n = parseFloat(v.replace(/[£,%\s]/g, '')); return /^-?[£\d.,%\s]+$/.test(v) && !isNaN(n) ? n : /^\d{4}-\d{2}-\d{2}/.test(v) ? v : v.toLowerCase(); };
      const rows = [...table.tBodies[0].rows].filter((r) => r.cells.length > 1);
      rows.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'asc' ? 1 : -1); }).forEach((r) => table.tBodies[0].appendChild(r));
    };
    th.addEventListener('click', (e) => { if (!e.target.closest('input,button')) sortNow(); });
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter') sortNow(); });
  });
  const wrap = table.closest('.tablewrap'); if (!wrap || wrap.previousElementSibling?.classList?.contains('tbar')) { applyCols(); return; }
  const bar = document.createElement('div'); bar.className = 'tbar';
  bar.innerHTML = `<button class="btn sm" data-tb="cols">${ICON('<path d="M3 3h18v18H3zM9 3v18M15 3v18"/>')}Columns</button><button class="btn sm" data-tb="views">${ICON('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>')}Views</button><button class="btn sm" data-tb="xls">${ICON('<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/>')}Excel</button>`;
  wrap.before(bar);
  const menu = (html) => { $$('.tmenu').forEach((m) => m.remove()); const m = document.createElement('div'); m.className = 'menu tmenu'; m.style.cssText = 'position:absolute;z-index:40;right:auto;top:auto'; m.innerHTML = html; bar.style.position = 'relative'; bar.appendChild(m); setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', off); } }), 0); return m; };
  bar.querySelector('[data-tb=cols]').onclick = () => { const m = menu(ths.map((th, i) => th.textContent.trim() && !th.querySelector('input') ? `<label style="display:flex;gap:8px;padding:5px 8px;cursor:pointer"><input type="checkbox" data-ci="${i}" ${hidden.includes(i) ? '' : 'checked'}> ${esc(th.textContent.replace(/[▲▼]/g, '').trim())}</label>` : '').join(''));
    $$('[data-ci]', m).forEach((c) => (c.onchange = () => { const i = +c.dataset.ci; hidden = c.checked ? hidden.filter((x) => x !== i) : [...hidden, i]; try { localStorage.setItem('cols:' + key, JSON.stringify(hidden)); } catch (_) {} applyCols(); })); };
  bar.querySelector('[data-tb=xls]').onclick = () => { const vis = ths.map((th, i) => [i, th.textContent.replace(/[▲▼]/g, '').trim()]).filter(([i, l]) => l && !hidden.includes(i));
    const rows = [...table.tBodies[0].rows].filter((r) => r.cells.length > 1).map((r) => Object.fromEntries(vis.map(([i, l]) => { const c = r.cells[i]; const el = c?.querySelector('input,select'); return [l, (el ? el.value : c?.textContent || '').trim()]; })));
    exportRows((document.querySelector('.head h1')?.textContent || 'Table').trim(), rows, vis.map(([, l]) => [l, l])); };
  bar.querySelector('[data-tb=views]').onclick = async () => {
    const page = location.hash.split('?')[0]; const { data: views, error } = await sb.from('saved_views').select('*').eq('page', page).order('name');
    const m = menu(`${error ? '<div class="who soft">Run phase13 SQL to enable saved views.</div>' : ''}${(views || []).map((v) => `<div style="display:flex;align-items:center;gap:6px"><button data-v="${v.id}" style="flex:1">${esc(v.name)}</button><button data-vd="${v.id}" title="Delete" style="width:auto">✕</button></div>`).join('') || '<div class="who soft">No saved views yet.</div>'}<hr><button data-vs>＋ Save current filters and columns</button>`);
    m.querySelector('[data-vs]').onclick = async () => { const name = prompt('Name this view'); if (!name) return; const fields = Object.fromEntries($$('.main .head select, .main .head input, .main .row select, .main .row input').filter((el) => el.id && el.type !== 'file' && el.type !== 'checkbox').map((el) => [el.id, el.value])); const { error: e2 } = await sb.from('saved_views').insert({ page, name, config: { fields, hidden, key } }); toast(e2 ? e2.message : 'View saved.', !!e2); m.remove(); };
    $$('[data-v]', m).forEach((b) => (b.onclick = () => { const v = views.find((x) => String(x.id) === b.dataset.v); Object.entries(v.config.fields || {}).forEach(([id, val]) => { const el = document.getElementById(id); if (el && el.value !== val) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('input', { bubbles: true })); } }); if (v.config.key === key) { hidden = v.config.hidden || []; applyCols(); } toast(`View "${v.name}" applied.`); m.remove(); }));
    $$('[data-vd]', m).forEach((b) => (b.onclick = async () => { await sb.from('saved_views').delete().eq('id', b.dataset.vd); m.remove(); toast('View deleted.'); }));
  };
  applyCols();
}
new MutationObserver(() => { const m = $('#main'); if (m) $$('.tablewrap table', m).forEach(enhanceTable); }).observe(document.getElementById('app'), { childList: true, subtree: true });

const empty = (title, hint = '', action = '') => `<div class="empty"><div class="emptyicon">${ICON('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>')}</div><b>${esc(title)}</b>${hint ? `<span>${esc(hint)}</span>` : ''}${action}</div>`;

/* ---------- P3: Recruitment pipeline (kanban) ---------- */
const SOURCES = ['Indeed', 'Referral', 'Agency', 'Facebook', 'Gumtree', 'Walk-in', 'Rehire', 'Job board', 'Other'];
async function pagePipeline() {
  const edit = can('recruitment', 'edit');
  const st = (S.pipe ||= { rec: '', q: '' });
  shell(`<div class="head"><div><div class="soft">Recruitment</div><h1>Hiring pipeline</h1><p class="muted" style="margin:2px 0 0">Drag cards between columns to change status.</p></div><div class="row">
    <label class="f">Search<input id="kq" value="${esc(st.q)}" placeholder="Site, role, candidate"></label><label class="f">Recruiter<select id="kr"><option value="">Everyone</option>${(S.settings.recruiters || []).map((r) => `<option ${st.rec === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>${edit ? '<button class="btn pri" id="kAdd">New vacancy</button>' : ''}</div></div>
    <section class="grid" id="kK">${SKEL}</section><div class="kanban" id="kB"></div><section class="charts"><div class="card"><h2>Hires by source</h2><canvas id="kS"></canvas></div><div class="card"><h2>Days to hire by recruiter</h2><canvas id="kT"></canvas></div></section>`);
  const [H, TL, TR] = await Promise.all([fetchAll('hires', '*'), sb.from('training_links').select('token,hire_id').then((r) => r.data || []), sb.from('training_results').select('token,passed').then((r) => r.data || [])]);
  if (!$('#kB')) return;
  const days = (h) => h.raised_on ? Math.round((Date.now() - new Date(h.raised_on)) / 864e5) : null, tth = (h) => h.raised_on && h.start_date ? Math.round((new Date(h.start_date) - new Date(h.raised_on)) / 864e5) : null;
  const passed = new Set(TR.filter((r) => r.passed).map((r) => r.token)), sgByHire = new Map(); TL.forEach((l) => { if (l.hire_id) sgByHire.set(l.hire_id, sgByHire.get(l.hire_id) || passed.has(l.token)); });
  const draw = () => {
    st.q = $('#kq').value.toLowerCase(); st.rec = $('#kr').value;
    const L = H.filter((h) => (!st.rec || h.recruiter === st.rec) && (!st.q || [h.site, h.role, h.candidate, h.contract].join(' ').toLowerCase().includes(st.q)));
    const filled = L.filter((h) => h.status === 'Filled'), t = filled.map(tth).filter((x) => x != null && x >= 0), recent = filled.filter((h) => (h.start_date || h.raised_on || '') >= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
    const sgN = filled.filter((h) => sgByHire.has(h.id)), sgP = sgN.filter((h) => sgByHire.get(h.id)).length;
    const k = (l, v, sub, c, rows) => `<div class="card kpi click" style="--c:var(${c})" ${dset('pk' + l.replace(/\W/g, ''), l, rows, COLS.hire)}><span>${l}</span><b>${v}</b><small>${sub}</small></div>`;
    $('#kK').innerHTML = k('Open roles', L.filter((h) => h.status !== 'Filled').length, 'vacant, in progress, offer, on hold', '--unplanned', L.filter((h) => h.status !== 'Filled')) + k('Filled (30 days)', recent.length, 'started in the last 30 days', '--filled', recent) + k('Avg time to hire', t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) + ' d' : '—', `median ${t.length ? t.sort((a, b) => a - b)[Math.floor(t.length / 2)] : '—'} days`, '--offer', filled) + k('Oldest open', Math.max(0, ...L.filter((h) => h.status !== 'Filled').map((h) => days(h) || 0)) + ' d', 'since raised', '--danger', L.filter((h) => h.status !== 'Filled').sort((a, b) => (days(b) || 0) - (days(a) || 0))) + k('Safeguarding done', sgN.length ? Math.round(sgP / sgN.length * 100) + '%' : '—', `${sgP} of ${sgN.length} new hires passed`, '--raised', sgN);
    const COLSK = [['Vacant', '--unplanned'], ['In Progress', '--prog'], ['Offer', '--offer'], ['Filled', '--filled'], ['On Hold', '--hold']];
    $('#kB').innerHTML = COLSK.map(([s2, c]) => { const items = L.filter((h) => (h.status || 'Vacant') === s2 && (s2 !== 'Filled' || recent.includes(h)));
      return `<section class="kcol" data-col="${s2}"><header><span class="chip" style="--c:var(${c})">${s2}</span><b>${items.length}</b>${s2 === 'Filled' ? '<span class="soft" style="font-size:11px">last 30 days</span>' : ''}</header><div class="kitems">${items.map((h) => `<article class="kcard" draggable="${edit}" data-id="${h.id}"><b>${esc(h.site || 'Site not set')}</b><span class="soft">${esc(h.role || '')}${h.headcount > 1 ? ' ×' + h.headcount : ''}</span>${h.candidate ? `<span>👤 ${esc(h.candidate)}</span>` : ''}<div class="kmeta"><span>${esc(h.recruiter || 'Unassigned')}</span>${h.source ? `<span class="chip" style="--c:var(--planned)">${esc(h.source)}</span>` : ''}<span class="${(days(h) || 0) > 21 && s2 !== 'Filled' ? 'err' : 'soft'}">${days(h) ?? ''}d</span></div></article>`).join('') || '<div class="soft" style="padding:10px;font-size:12px">Nothing here</div>'}</div></section>`; }).join('');
    if (edit) {
      $$('.kcard').forEach((c) => { c.ondragstart = (e) => { e.dataTransfer.setData('text', c.dataset.id); c.classList.add('drag'); }; c.ondragend = () => c.classList.remove('drag'); });
      $$('.kcol').forEach((col) => { col.ondragover = (e) => { e.preventDefault(); col.classList.add('over'); }; col.ondragleave = () => col.classList.remove('over');
        col.ondrop = async (e) => { e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text'), status = col.dataset.col, h = H.find((x) => x.id === id); if (!h || h.status === status) return;
          const patch = { status }; if (status === 'Filled' && !h.start_date) patch.start_date = new Date().toISOString().slice(0, 10);
          const { error } = await sb.from('hires').update(patch).eq('id', id); if (error) return toast(error.message, true); Object.assign(h, patch); toast(`${h.site}: moved to ${status}.`); draw(); }; });
    }
    $$('.kcard').forEach((c) => c.addEventListener('dblclick', () => openComments('hire', c.dataset.id, H.find((h) => h.id === c.dataset.id)?.site || 'Vacancy')));
    S.charts.forEach((x) => x.destroy()); S.charts = [];
    Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border');
    const bySrc = {}; filled.forEach((h) => { const s2 = h.source || 'Not recorded'; bySrc[s2] = (bySrc[s2] || 0) + 1; });
    S.charts.push(new Chart($('#kS'), { type: 'doughnut', data: { labels: Object.keys(bySrc), datasets: [{ data: Object.values(bySrc), backgroundColor: ['--acc', '--filled', '--prog', '--raised', '--unplanned', '--offer', '--planned', '--hold', '--danger', '--soft'].map(cssv), borderWidth: 0 }] }, options: { cutout: '60%' } }));
    const byRec = {}; filled.forEach((h) => { const x = tth(h); if (x != null && x >= 0) (byRec[h.recruiter || 'Unassigned'] ||= []).push(x); });
    const rr = Object.entries(byRec).map(([r, a]) => [r, Math.round(a.reduce((x, y) => x + y, 0) / a.length)]).sort((a, b) => a[1] - b[1]);
    S.charts.push(new Chart($('#kT'), { type: 'bar', data: { labels: rr.map((x) => x[0]), datasets: [{ data: rr.map((x) => x[1]), backgroundColor: cssv('--offer'), borderRadius: 6 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } }));
  };
  $('#kq').oninput = draw; $('#kr').onchange = draw;
  if ($('#kAdd')) $('#kAdd').onclick = () => { location.hash = '#/hiring'; let n = 0; const t2 = setInterval(() => { const el = $('#hAdd'); if (el || ++n > 40) { clearInterval(t2); el && el.click(); } }, 150); };
  draw();
}

/* ---------- P3: Live cover board + cover cost ---------- */
const shiftHours = (s) => { const m = String(s || '').toLowerCase().match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/); if (!m) return null; const t = (h, mi, ap) => { h = +h; if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return h + (+mi || 0) / 60; }; let a = t(m[1], m[2], m[3] || m[6]), b = t(m[4], m[5], m[6]); if (b <= a) b += 12; const d = b - a; return d > 0 && d < 16 ? Math.round(d * 100) / 100 : null; };
const coverDays = (c) => c.date_from ? Math.max(1, Math.round((new Date(c.date_to || c.date_from) - new Date(c.date_from)) / 864e5) + 1) : 1;
const coverCost = (c) => c.cost != null ? +c.cost : (() => { const h = c.hours != null ? +c.hours : shiftHours(c.shift); return h && c.rate ? Math.round(h * +c.rate * coverDays(c) * 100) / 100 : null; })();
async function pageCoverBoard() {
  const edit = can('covers', 'edit');
  shell(`<div class="head"><div><div class="soft">Covers</div><h1>Live cover board</h1><p class="muted" style="margin:2px 0 0">Today and the next two days. Red cards still need a cover cleaner.</p></div><div class="row"><span class="soft" id="cbAt"></span></div></div>
    <section class="grid" id="cbK">${SKEL}</section><div class="kanban" id="cbB" style="grid-template-columns:repeat(3,minmax(260px,1fr))"></div>
    <section class="charts"><div class="card"><h2>Cover cost by month</h2><canvas id="cbC"></canvas></div><div class="card"><h2>Most expensive sites (this month)</h2><div id="cbS"></div></div></section>`);
  const d0 = new Date().toISOString().slice(0, 10), d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10), y1 = new Date(); y1.setMonth(y1.getMonth() - 5); y1.setDate(1);
  const [live, hist] = await Promise.all([fetchAll('covers', '*', (q) => q.lte('date_from', d(2)).gte('date_to', d0)), fetchAll('covers', 'id,date_from,date_to,site,shift,rate,hours,cost,cover_cleaner,notes', (q) => q.gte('date_from', y1.toISOString().slice(0, 10)))]);
  const live2 = [...live, ...(await fetchAll('covers', '*', (q) => q.is('date_to', null).gte('date_from', d0).lte('date_from', d(2))))];
  if (!$('#cbB')) return;
  const L = Object.values(Object.fromEntries(live2.map((c) => [c.id, c])));
  const on = (day) => L.filter((c) => c.date_from <= day && (c.date_to || c.date_from) >= day);
  const unf = (c) => coverState(c) === 'missed';
  const mo = d0.slice(0, 7), thisM = hist.filter((c) => c.date_from.startsWith(mo)), costM = thisM.reduce((s2, c) => s2 + (coverCost(c) || 0), 0), unknown = thisM.filter((c) => coverCost(c) == null).length;
  const k = (l, v, sub, c, rows) => `<div class="card kpi click" style="--c:var(${c})" ${dset('cb' + l.replace(/\W/g, ''), l, rows, [...COLS.cover, ['shift', 'Shift'], ['cost', 'Cost £', (r) => coverCost(r) ?? '']])}><span>${l}</span><b>${v}</b><small>${sub}</small></div>`;
  $('#cbK').innerHTML = k('Unfilled today', on(d0).filter(unf).length, 'no cover cleaner yet', '--danger', on(d0).filter(unf)) + k('Unfilled tomorrow', on(d(1)).filter(unf).length, 'act today', '--prog', on(d(1)).filter(unf)) + k('Covers today', on(d0).length, `${on(d0).filter((c) => !unf(c)).length} filled`, '--acc', on(d0)) + k('Cover cost this month', money(costM), unknown ? `${unknown} covers without shift or rate` : 'from shift hours × rate', '--raised', thisM);
  $('#cbAt').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · refreshes every minute';
  $('#cbB').innerHTML = [d0, d(1), d(2)].map((day, i) => { const items = on(day).sort((a, b) => unf(b) - unf(a));
    return `<section class="kcol"><header><b>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : new Date(day).toLocaleDateString('en-GB', { weekday: 'long' })}</b><span class="soft">${new Date(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span><span class="chip" style="--c:var(${items.filter(unf).length ? '--danger' : '--filled'});margin-left:auto">${items.filter(unf).length} unfilled</span></header><div class="kitems">${items.map((c) => `<article class="kcard ${unf(c) ? 'kred' : ''}"><b>${esc(c.site || 'Site not set')}</b><span class="soft">${esc(c.shift || 'Shift not set')} · ${esc(c.kind)}</span><span>${unf(c) ? '<b class="err">UNFILLED</b>' : '✓ ' + esc(c.cover_cleaner)}</span><span class="soft" style="font-size:12px">Covering ${esc(c.absent_cleaner || '—')}</span>${edit ? `<div class="kmeta"><input data-cc="${c.id}" placeholder="${unf(c) ? 'Assign cover cleaner' : 'Change cleaner'}" value="${unf(c) ? '' : esc(c.cover_cleaner || '')}" aria-label="Cover cleaner"></div>` : ''}</article>`).join('') || '<div class="soft" style="padding:10px">No covers</div>'}</div></section>`; }).join('');
  $$('[data-cc]').forEach((inp) => (inp.onchange = async () => { const { error } = await sb.from('covers').update({ cover_cleaner: inp.value.trim() || null }).eq('id', inp.dataset.cc); toast(error ? error.message : 'Cover cleaner saved.', !!error); if (!error) pageCoverBoard(); }));
  Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border');
  const ms = [...Array(6)].map((_, i) => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - 5 + i); return x.toISOString().slice(0, 7); });
  S.charts.push(new Chart($('#cbC'), { type: 'bar', data: { labels: ms.map((m) => MN[+m.slice(5) - 1]), datasets: [{ label: 'Cover cost £', data: ms.map((m) => Math.round(hist.filter((c) => c.date_from.startsWith(m)).reduce((s2, c) => s2 + (coverCost(c) || 0), 0))), backgroundColor: cssv('--raised'), borderRadius: 6 }] }, options: { plugins: { legend: { display: false } } } }));
  const bySite = {}; thisM.forEach((c) => { const v = coverCost(c); if (v) bySite[c.site || '—'] = (bySite[c.site || '—'] || 0) + v; });
  $('#cbS').innerHTML = `<div class="list">${Object.entries(bySite).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, v]) => `<div><span>${esc(n)}</span><b>${money(v)}</b></div>`).join('') || empty('No costed covers this month', 'Add shift times and rates on Covers to see costs.')}</div>`;
  clearInterval(S.cbTimer); S.cbTimer = setInterval(() => { if (location.hash.startsWith('#/cover-board') && $('#modal').hidden && !document.activeElement?.matches('input')) pageCoverBoard(); else if (!location.hash.startsWith('#/cover-board')) clearInterval(S.cbTimer); }, 60000);
}

/* ---------- P4: Operations (audits, complaints, supplier orders, small-order charges) ---------- */
const OPS = {
  audits: { label: 'Site audits', order: 'audit_date', fields: [['site', 'Site', 'site'], ['audit_date', 'Date', 'date'], ['auditor', 'Auditor', 'text'], ['score', 'Score %', 'number'], ['result', 'Result', ['Pass', 'Improve', 'Fail']], ['issues', 'Issues found', 'textarea'], ['actions', 'Actions', 'textarea'], ['due_date', 'Actions due', 'date']] },
  complaints: { label: 'Complaints', order: 'received_on', fields: [['site', 'Site', 'site'], ['received_on', 'Received', 'date'], ['category', 'Category', ['Standards', 'Missed clean', 'Staff conduct', 'Supplies', 'Security', 'Invoice', 'Other']], ['severity', 'Severity', ['Low', 'Medium', 'High']], ['description', 'What happened', 'textarea'], ['status', 'Status', ['Open', 'In progress', 'Resolved']], ['owner', 'Owner', 'text'], ['resolved_on', 'Resolved on', 'date']] },
  supplier_orders: { label: 'Supplier orders', order: 'order_date', fields: [['site', 'Site', 'site'], ['supplier', 'Supplier', 'text'], ['order_date', 'Order date', 'date'], ['value', 'Order value £', 'number'], ['small_order_charge', 'Small-order charge £', 'number'], ['delivery_charge', 'Delivery charge £', 'number'], ['ordered_by', 'Ordered by', 'text'], ['notes', 'Notes', 'textarea']] },
};
async function pageOperations() {
  const edit = can('operations', 'edit'), st = (S.ops ||= { tab: 'audits', q: '' });
  const TABS = [['audits', 'Site audits'], ['complaints', 'Complaints'], ['supplier_orders', 'Supplier orders'], ['charges', 'Small-order charges']];
  shell(`<div class="head"><div><div class="soft">Operations</div><h1>${TABS.find((t) => t[0] === st.tab)[1]}</h1></div><div class="row"><label class="f">Search<input id="oq" value="${esc(st.q)}" placeholder="Site, supplier, owner…"></label>${edit && st.tab !== 'charges' ? '<button class="btn pri" id="oAdd">Add</button>' : ''}</div></div>
    <div class="tabs" role="tablist">${TABS.map(([k2, l]) => `<button role="tab" data-ot="${k2}" aria-selected="${st.tab === k2}" class="${st.tab === k2 ? 'on' : ''}">${l}</button>`).join('')}</div><div id="oBody2">${SKEL}</div>${siteList()}`);
  $$('[data-ot]').forEach((b) => (b.onclick = () => { st.tab = b.dataset.ot; pageOperations(); }));
  const table = st.tab === 'charges' ? 'supplier_orders' : st.tab, cfg = OPS[table];
  const { data, error } = await sb.from(table).select('*').order(cfg.order, { ascending: false }).limit(2000);
  if (!$('#oBody2')) return;
  if (error) { $('#oBody2').innerHTML = `<div class="card">${empty('Operations tables not set up yet', 'Run phase13-super-portal.sql in Supabase, then refresh.')}</div>`; return; }
  const q = () => ($('#oq').value || '').toLowerCase();
  const rowsF = () => data.filter((r) => !q() || Object.values(r).join(' ').toLowerCase().includes(q()));
  const k = (l, v, sub, c, rows) => `<div class="card kpi click" style="--c:var(${c})" ${dset('ok' + l.replace(/\W/g, ''), l, rows, cfg.fields.map(([f, l2]) => [f, l2]))}><span>${l}</span><b>${v}</b><small>${sub}</small></div>`;
  const m30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const draw = () => {
    st.q = q(); const R = rowsF();
    let kpis = '';
    if (table === 'audits') { const r30 = R.filter((r) => r.audit_date >= m30), avg = r30.length ? Math.round(r30.reduce((a, b) => a + (+b.score || 0), 0) / r30.length) : null; kpis = k('Audits (30 days)', r30.length, 'carried out', '--acc', r30) + k('Average score', avg == null ? '—' : avg + '%', 'last 30 days', '--filled', r30) + k('Failed', R.filter((r) => r.result === 'Fail').length, 'all time', '--danger', R.filter((r) => r.result === 'Fail')) + k('Actions overdue', R.filter((r) => r.due_date && r.due_date < new Date().toISOString().slice(0, 10) && r.result !== 'Pass').length, 'past due date', '--prog', R.filter((r) => r.due_date && r.due_date < new Date().toISOString().slice(0, 10) && r.result !== 'Pass')); }
    if (table === 'complaints') { const open = R.filter((r) => r.status !== 'Resolved'), res = R.filter((r) => r.resolved_on && r.received_on), avgD = res.length ? Math.round(res.reduce((a, r) => a + (new Date(r.resolved_on) - new Date(r.received_on)) / 864e5, 0) / res.length) : null; kpis = k('Open complaints', open.length, `${open.filter((r) => r.severity === 'High').length} high severity`, '--danger', open) + k('Last 30 days', R.filter((r) => r.received_on >= m30).length, 'received', '--acc', R.filter((r) => r.received_on >= m30)) + k('Avg days to resolve', avgD ?? '—', 'resolved complaints', '--filled', res) + k('Repeat sites', Object.values(R.reduce((o, r) => ((o[r.site] = (o[r.site] || 0) + 1), o), {})).filter((n) => n > 1).length, '2+ complaints', '--prog', R); }
    if (table === 'supplier_orders') { const mo = new Date().toISOString().slice(0, 7), M = R.filter((r) => (r.order_date || '').startsWith(mo)); kpis = k('Orders this month', M.length, money(M.reduce((a, r) => a + (+r.value || 0), 0)) + ' total', '--acc', M) + k('Small-order charges', money(M.reduce((a, r) => a + (+r.small_order_charge || 0), 0)), 'this month · target £0', '--danger', M.filter((r) => +r.small_order_charge > 0)) + k('Delivery charges', money(M.reduce((a, r) => a + (+r.delivery_charge || 0), 0)), 'this month', '--prog', M.filter((r) => +r.delivery_charge > 0)); }
    if (st.tab === 'charges') {
      const ms = [...Array(12)].map((_, i) => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - 11 + i); return x.toISOString().slice(0, 7); });
      const ch = R.filter((r) => +r.small_order_charge > 0 || +r.delivery_charge > 0), bySite = {}, byWho = {}; ch.forEach((r) => { const v = (+r.small_order_charge || 0) + (+r.delivery_charge || 0); bySite[r.site || '—'] = (bySite[r.site || '—'] || 0) + v; byWho[r.ordered_by || 'Unknown'] = (byWho[r.ordered_by || 'Unknown'] || 0) + v; });
      $('#oBody2').innerHTML = `<div style="display:flex;flex-direction:column;gap:14px"><section class="grid">${kpis}${k('Charges (12 months)', money(ch.reduce((a, r) => a + (+r.small_order_charge || 0) + (+r.delivery_charge || 0), 0)), `${ch.length} orders with a charge`, '--raised', ch)}</section>
        <section class="charts"><div class="card wide"><h2>Small-order and delivery charges by month · target £0</h2><canvas id="ocM" height="70"></canvas></div><div class="card"><h2>Sites paying most charges</h2><div class="list">${Object.entries(bySite).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, v]) => `<div><span>${esc(n)}</span><b>${money(v)}</b></div>`).join('') || empty('No charges', 'Log orders in Supplier orders.')}</div></div><div class="card"><h2>Charges by who ordered</h2><div class="list">${Object.entries(byWho).sort((a, b) => b[1] - a[1]).map(([n, v]) => `<div><span>${esc(n)}</span><b>${money(v)}</b></div>`).join('') || empty('No charges yet')}</div></div></section></div>`;
      Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border');
      S.charts.push(new Chart($('#ocM'), { type: 'bar', data: { labels: ms.map((m) => MN[+m.slice(5) - 1] + ' ' + m.slice(2, 4)), datasets: [{ label: 'Small-order', data: ms.map((m) => R.filter((r) => (r.order_date || '').startsWith(m)).reduce((a, r) => a + (+r.small_order_charge || 0), 0)), backgroundColor: cssv('--danger'), stack: 's', borderRadius: 4 }, { label: 'Delivery', data: ms.map((m) => R.filter((r) => (r.order_date || '').startsWith(m)).reduce((a, r) => a + (+r.delivery_charge || 0), 0)), backgroundColor: cssv('--prog'), stack: 's', borderRadius: 4 }] }, options: { scales: { x: { stacked: true }, y: { stacked: true } } } }));
      return;
    }
    const show = cfg.fields.filter(([, , t]) => t !== 'textarea' || table === 'complaints').slice(0, 8);
    $('#oBody2').innerHTML = `<div style="display:flex;flex-direction:column;gap:14px"><section class="grid">${kpis}</section><div class="tablewrap"><table><thead><tr>${show.map(([, l]) => `<th>${l}</th>`).join('')}<th></th></tr></thead><tbody>${R.map((r) => `<tr>${show.map(([f, , t]) => `<td>${f === 'result' || f === 'severity' || f === 'status' ? chip(r[f], { Pass: '--filled', Improve: '--prog', Fail: '--danger', Low: '--hold', Medium: '--prog', High: '--danger', Open: '--danger', 'In progress': '--prog', Resolved: '--filled' }) : t === 'number' && /£/.test(cfg.fields.find((x) => x[0] === f)[1]) ? money(+r[f] || 0) : esc(String(r[f] ?? '').slice(0, 120))}</td>`).join('')}<td style="white-space:nowrap">${edit ? `<button class="btn sm" data-oe="${r.id}">Edit</button> ` : ''}<button class="btn sm" data-oc="${r.id}">💬</button></td></tr>`).join('') || `<tr><td colspan="${show.length + 1}">${empty('Nothing recorded yet', edit ? 'Click Add to record the first one.' : '')}</td></tr>`}</tbody></table></div></div>`;
    $$('[data-oe]').forEach((b) => (b.onclick = () => opsForm(table, data.find((x) => x.id === b.dataset.oe))));
    $$('[data-oc]').forEach((b) => (b.onclick = () => { const r = data.find((x) => x.id === b.dataset.oc); openComments(table, r.id, `${cfg.label}: ${r.site || ''}`); }));
  };
  $('#oq').oninput = draw; if ($('#oAdd')) $('#oAdd').onclick = () => opsForm(table, null);
  draw();
}
function opsForm(table, row) {
  const cfg = OPS[table], m = $('#modal'); m.hidden = false;
  const inp = ([f, l, t]) => { const v = row?.[f] ?? (t === 'date' && /date|received/.test(f) && !/due|resolved/.test(f) ? new Date().toISOString().slice(0, 10) : '');
    if (Array.isArray(t)) return `<label class="f">${l}<select name="${f}">${['', ...t].map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    if (t === 'textarea') return `<label class="f" style="grid-column:1/-1">${l}<textarea name="${f}" style="min-height:80px;font-family:var(--font)">${esc(v)}</textarea></label>`;
    return `<label class="f">${l}<input name="${f}" type="${t === 'site' ? 'text' : t}" ${t === 'site' ? 'list="siteList" required' : ''} value="${esc(v)}" ${t === 'number' ? 'step="0.01"' : ''}></label>`; };
  m.innerHTML = `<form class="box" id="opF" role="dialog" aria-modal="true" aria-label="${cfg.label}"><h2>${row ? 'Edit' : 'Add'} · ${cfg.label}</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px">${cfg.fields.map(inp).join('')}</div>
    <div class="row" style="justify-content:flex-end">${row ? '<button type="button" class="btn" id="opD">Delete</button>' : ''}<button type="button" class="btn" id="opX">Cancel</button><button class="btn pri">Save</button></div></form>${siteList()}`;
  $('#opX').onclick = () => (m.hidden = true);
  $('#opF').onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); Object.keys(f).forEach((k2) => { if (f[k2] === '') f[k2] = null; }); const s2 = S.sites.find((x) => x.name.toLowerCase() === (f.site || '').toLowerCase()); f.site_id = s2?.id || null;
    const { error } = row ? await sb.from(table).update(f).eq('id', row.id) : await sb.from(table).insert(f); if (error) return toast(error.message, true); m.hidden = true; toast('Saved.'); pageOperations(); };
  if ($('#opD')) $('#opD').onclick = async () => { if (!confirm('Delete this record?')) return; const { error } = await sb.from(table).delete().eq('id', row.id); if (error) return toast(error.message, true); m.hidden = true; pageOperations(); };
}

/* ---------- P4: Documents per site / contract ---------- */
async function openDocs(type, id, label) {
  const m = $('#modal'); m.hidden = false; m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Documents"><h2>Documents · ${esc(label)}</h2><div id="dcL">${SKEL}</div><div class="row" style="justify-content:space-between">${can('operations', 'edit') || can('contracts', 'edit') ? '<label class="btn pri" style="cursor:pointer">Upload files<input type="file" id="dcU" multiple hidden></label>' : '<span></span>'}<button class="btn" id="dcX">Close</button></div></div>`;
  $('#dcX').onclick = () => (m.hidden = true);
  const load = async () => { const { data, error } = await sb.from('documents').select('*').eq('record_type', type).eq('record_id', id).order('uploaded_at', { ascending: false });
    if (error) { $('#dcL').innerHTML = empty('Documents not set up yet', 'Run phase13-super-portal.sql.'); return; }
    $('#dcL').innerHTML = data.length ? `<div class="list">${data.map((d) => `<div><span>📄 ${esc(d.name)}<br><span class="soft">${new Date(d.uploaded_at).toLocaleDateString('en-GB')} · ${Math.max(1, Math.round((d.size || 0) / 1024))} KB</span></span><span style="display:flex;gap:6px"><button class="btn sm" data-dl="${esc(d.path)}">Open</button>${can('operations', 'edit') || can('contracts', 'edit') ? `<button class="btn sm" data-dd="${d.id}" data-dp="${esc(d.path)}">Delete</button>` : ''}</span></div>`).join('')}</div>` : empty('No documents yet', 'Upload contracts, specs, audits, risk assessments or COSHH sheets.');
    $$('[data-dl]').forEach((b) => (b.onclick = async () => { const { data: u, error: e2 } = await sb.storage.from('documents').createSignedUrl(b.dataset.dl, 120); if (e2) return toast(e2.message, true); window.open(u.signedUrl, '_blank'); }));
    $$('[data-dd]').forEach((b) => (b.onclick = async () => { if (!confirm('Delete this file?')) return; await sb.storage.from('documents').remove([b.dataset.dp]); await sb.from('documents').delete().eq('id', b.dataset.dd); load(); })); };
  if ($('#dcU')) $('#dcU').onchange = async (e) => { for (const f of e.target.files) { if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is over 20 MB.`, true); continue; } const path = `${type}/${id}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, '_')}`;
      const { error } = await sb.storage.from('documents').upload(path, f); if (error) { toast(error.message, true); continue; } await sb.from('documents').insert({ record_type: type, record_id: id, name: f.name, path, size: f.size }); } toast('Uploaded.'); load(); };
  load();
}

/* ---------- P4: Comments with @mentions ---------- */
async function openComments(type, id, label) {
  const m = $('#modal'); m.hidden = false;
  if (!S.people) S.people = (await sb.from('profiles').select('id,full_name').eq('active', true)).data || [];
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-label="Comments"><h2>💬 ${esc(label)}</h2><div id="cmL" class="cmlist">${SKEL}</div>
    <div style="position:relative"><textarea id="cmT" placeholder="Write a comment. Type @ to mention someone." style="min-height:70px;font-family:var(--font)"></textarea><div class="menu" id="cmM" hidden style="top:auto;bottom:100%;left:0;right:auto"></div></div>
    <div class="row" style="justify-content:flex-end"><button class="btn" id="cmX">Close</button><button class="btn pri" id="cmS">Post</button></div></div>`;
  $('#cmX').onclick = () => (m.hidden = true);
  const load = async () => { const { data, error } = await sb.from('comments').select('*, profiles(full_name)').eq('record_type', type).eq('record_id', String(id)).order('created_at');
    if (error) { $('#cmL').innerHTML = empty('Comments not set up yet', 'Run phase13-super-portal.sql.'); return; }
    $('#cmL').innerHTML = data.length ? data.map((c) => `<div class="cm"><div class="avatar" style="width:28px;height:28px;font-size:10px;cursor:default">${esc((c.profiles?.full_name || '?').split(' ').map((x) => x[0]).slice(0, 2).join(''))}</div><div><b>${esc(c.profiles?.full_name || 'Someone')}</b> <span class="soft">${new Date(c.created_at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</span><div>${esc(c.body).replace(/@([\w ]+?)(?=\s|$|[.,!?])/g, '<b style="color:var(--acc)">@$1</b>')}</div></div></div>`).join('') : empty('No comments yet', 'Start the conversation. Mention a colleague with @.');
    $('#cmL').scrollTop = 1e9; };
  const t = $('#cmT'), menu = $('#cmM');
  t.oninput = () => { const pos = t.selectionStart, before = t.value.slice(0, pos), mm = before.match(/@([\w]*)$/); if (!mm) { menu.hidden = true; return; }
    const list = S.people.filter((p) => p.full_name.toLowerCase().includes(mm[1].toLowerCase())).slice(0, 6); if (!list.length) { menu.hidden = true; return; }
    menu.hidden = false; menu.innerHTML = list.map((p) => `<button data-pm="${p.id}">${esc(p.full_name)}</button>`).join('');
    $$('[data-pm]', menu).forEach((b) => (b.onclick = () => { const p = S.people.find((x) => x.id === b.dataset.pm); t.value = before.replace(/@([\w]*)$/, '@' + p.full_name + ' ') + t.value.slice(pos); menu.hidden = true; t.focus(); })); };
  $('#cmS').onclick = async () => { const body = t.value.trim(); if (!body) return; const mentions = S.people.filter((p) => body.includes('@' + p.full_name)).map((p) => p.id);
    const { error } = await sb.from('comments').insert({ record_type: type, record_id: String(id), record_label: label, body, mentions }); if (error) return toast(error.message, true); t.value = ''; load(); if (mentions.length) toast(`${mentions.length} person${mentions.length > 1 ? 's' : ''} notified.`); };
  load();
}

/* ---------- P5: AI everywhere ---------- */
const pageCtx = () => ({ title: ($('.head h1')?.textContent || '').trim(), page: location.hash, kpis: $$('.kpi').slice(0, 14).map((k2) => ({ label: k2.querySelector('span')?.textContent?.trim(), value: k2.querySelector('b')?.textContent?.trim(), note: k2.querySelector('small')?.textContent?.trim() })),
  datasets: Object.values(S.drills || {}).slice(0, 8).map((d) => ({ title: d.title, rows: d.rows.length, sample: d.rows.slice(0, 6).map((r) => Object.fromEntries(d.cols.slice(0, 7).map(([k2, l, f]) => [l, String(cellText(f ? f(r) : r[k2])).slice(0, 60)]))) })) });
function aiAsk(q) { if (!$('#aiFab')) return; openAI().then(() => askAI(q)); }
async function aiInsightsPanel() {
  $('#aiMsgs').insertAdjacentHTML('beforeend', '<div class="aim bot typing" id="aiT2"><span></span><span></span><span></span></div>'); $('#aiMsgs').scrollTop = 1e9;
  try { const r = await callFn('ai', { action: 'insights', page: location.hash, page_data: pageCtx() }); const IC = { risk: '⚠️', anomaly: '🔍', trend: '📈', action: '✅' };
    $('#aiT2').outerHTML = `<div class="aim bot"><b>Insights for this page</b>${(r.items || []).map((x) => `<div class="aiins"><span>${IC[x.type] || '•'}</span><div><b>${esc(x.title)}</b><br>${esc(x.detail)}</div></div>`).join('')}</div>`; }
  catch (e) { $('#aiT2').outerHTML = `<div class="aim bot err">${esc(e.message)}</div>`; }
  $('#aiMsgs').scrollTop = 1e9;
}

/* ---------- P5: Forecasts & risk ---------- */
async function pageForecast() {
  shell(`<div class="head"><div><div class="soft">Insights</div><h1>Forecasts and risk</h1><p class="muted" style="margin:2px 0 0">Statistical forecasts from your own history. Ask AI to explain any of them.</p></div><div class="row"><button class="btn pri" id="fcAI">✨ Explain with AI</button></div></div><div id="fcB">${SKEL}</div>`);
  const since = new Date(); since.setMonth(since.getMonth() - 12);
  const [C, E, K, P, CP] = await Promise.all([can('covers') ? fetchAll('covers', 'date_from,kind,site,site_id', (q) => q.gte('date_from', since.toISOString().slice(0, 10))) : [], can('brighthr') ? fetchAll('brighthr_employees', 'start_date,end_date,terminated').catch(() => []) : [], can('contracts') ? fetchAll('contracts', 'id,name,area_manager,target_margin_pct') : [], can('finance') ? fetchAll('pl_entries', 'contract_id,month,revenue,labour_cost,materials,other_costs').catch(() => []) : [], can('operations') ? sb.from('complaints').select('site_id,severity,status').then((r) => r.data || []) : []]);
  if (!$('#fcB')) return;
  // Cover demand: weekly totals, trend + weekday profile → next 4 weeks
  const wk = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
  const weeks = {}; C.forEach((c) => { if (c.date_from) weeks[wk(c.date_from)] = (weeks[wk(c.date_from)] || 0) + 1; });
  const thisWk = wk(new Date().toISOString().slice(0, 10)); const ws = Object.keys(weeks).filter((w) => w < thisWk).sort().slice(-26), wv = ws.map((w) => weeks[w]); const n = wv.length;
  const mean = n ? wv.reduce((a, b) => a + b, 0) / n : 0, xs = wv.map((_, i) => i), xm = (n - 1) / 2, slope = n > 2 ? xs.reduce((a, x, i) => a + (x - xm) * (wv[i] - mean), 0) / xs.reduce((a, x) => a + (x - xm) ** 2, 0) : 0;
  const recent = wv.slice(-8), base = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const fc = [1, 2, 3, 4].map((i) => Math.max(0, Math.round(base + slope * (i + 3.5))));
  const lastYear = (i) => { const d = new Date(); d.setDate(d.getDate() + 7 * i - 364); return weeks[wk(d)] || null; };
  const dow = [0, 0, 0, 0, 0, 0, 0]; C.forEach((c) => c.date_from && dow[(new Date(c.date_from).getDay() + 6) % 7]++);
  // Turnover: leavers per month over 12 months, projected
  const ms = [...Array(12)].map((_, i) => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - 11 + i); return x.toISOString().slice(0, 7); });
  const leavers = ms.map((m) => E.filter((e) => e.end_date?.startsWith(m)).length), headNow = E.filter((e) => !e.terminated).length, annLeave = leavers.reduce((a, b) => a + b, 0);
  const turnover = headNow ? Math.round(annLeave / headNow * 1000) / 10 : null, nextQ = Math.round(leavers.slice(-3).reduce((a, b) => a + b, 0) / 3 * 3);
  // Contract risk score
  const months = [...new Set(P.map((p) => p.month))].sort(), last3 = months.slice(-3);
  const siteContract = new Map(S.sites.map((s) => [s.id, s.contract_id])), covBy = {}, cmpBy = {};
  C.forEach((c) => { const k2 = siteContract.get(c.site_id); if (k2) covBy[k2] = (covBy[k2] || 0) + 1; }); CP.forEach((c) => { const k2 = siteContract.get(c.site_id); if (k2 && c.status !== 'Resolved') cmpBy[k2] = (cmpBy[k2] || 0) + (c.severity === 'High' ? 3 : 1); });
  const risk = K.map((k2) => { const pl = last3.map((m) => P.filter((p) => p.contract_id === k2.id && p.month === m).reduce((a, p) => ({ rev: a.rev + (+p.revenue || 0), m: a.m + (+p.revenue || 0) - (+p.labour_cost || 0) - (+p.materials || 0) - (+p.other_costs || 0) }), { rev: 0, m: 0 }));
    const lossM = pl.filter((x) => x.rev && x.m < 0).length, mp = pl.filter((x) => x.rev).map((x) => x.m / x.rev * 100), trend = mp.length >= 2 ? mp.at(-1) - mp[0] : 0;
    const score = Math.min(100, Math.round(lossM * 22 + (trend < -5 ? 15 : 0) + Math.min(20, (covBy[k2.id] || 0) / 3) + Math.min(20, (cmpBy[k2.id] || 0) * 5) + (mp.length && mp.at(-1) < (+k2.target_margin_pct || 15) ? 10 : 0)));
    return { ...k2, score, lossM, margin: mp.length ? Math.round(mp.at(-1) * 10) / 10 : null, trend: Math.round(trend * 10) / 10, covers: covBy[k2.id] || 0, complaints: cmpBy[k2.id] || 0 }; }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  const RC = [['name', 'Contract'], ['area_manager', 'Area Manager'], ['score', 'Risk score'], ['lossM', 'Loss months (last 3)'], ['margin', 'Latest margin %'], ['trend', 'Margin trend (pts)'], ['covers', 'Covers (12m)'], ['complaints', 'Open complaint points']];
  $('#fcB').innerHTML = `<div style="display:flex;flex-direction:column;gap:16px"><section class="grid">
    <div class="card kpi" style="--c:var(--acc)"><span>Covers next 4 weeks</span><b>${fc.reduce((a, b) => a + b, 0)}</b><small>forecast · ${slope > 0.3 ? '▲ rising' : slope < -0.3 ? '▼ falling' : 'steady'} trend</small></div>
    <div class="card kpi" style="--c:var(--unplanned)"><span>Busiest weekday</span><b>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dow.indexOf(Math.max(...dow))]}</b><small>most covers start this day</small></div>
    <div class="card kpi" style="--c:var(--danger)"><span>Staff turnover (12m)</span><b>${turnover == null ? '—' : turnover + '%'}</b><small>${annLeave} leavers · ~${nextQ} expected next quarter</small></div>
    <div class="card kpi click" style="--c:var(--raised)" ${dset('fcr', 'Contract risk', risk, RC)}><span>High-risk contracts</span><b>${risk.filter((r) => r.score >= 50).length}</b><small>score 50+ of 100</small></div></section>
    <section class="charts"><div class="card wide"><h2>Weekly covers · history and 4-week forecast</h2><canvas id="fcW" height="70"></canvas></div><div class="card"><h2>Leavers by month</h2><canvas id="fcL"></canvas></div><div class="card"><h2>Covers by weekday</h2><canvas id="fcD"></canvas></div></section>
    <section class="card"><h2>Contract risk ranking <span class="soft" style="font-weight:500;font-size:12px;margin-left:auto">losses, margin trend, cover load and complaints</span></h2><div class="tablewrap" style="box-shadow:none"><table><thead><tr>${RC.map(([, l]) => `<th>${l}</th>`).join('')}<th></th></tr></thead><tbody>${risk.slice(0, 40).map((r) => `<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.area_manager || '')}</td><td><span class="chip" style="--c:var(${r.score >= 50 ? '--danger' : r.score >= 25 ? '--prog' : '--filled'})">${r.score}</span></td><td>${r.lossM}</td><td>${r.margin ?? '—'}</td><td class="${r.trend < 0 ? 'err' : ''}">${r.trend}</td><td>${r.covers}</td><td>${r.complaints}</td><td><button class="btn sm" data-ra="${esc(r.name)}">✨ Why?</button></td></tr>`).join('') || `<tr><td colspan="9">${empty('No risk signals', 'Import P&L and log complaints to score contracts.')}</td></tr>`}</tbody></table></div></section></div>`;
  Chart.defaults.color = cssv('--muted'); Chart.defaults.borderColor = cssv('--border');
  const fl = [1, 2, 3, 4].map((i) => { const d = new Date(); d.setDate(d.getDate() + 7 * i); return 'wk ' + wk(d).slice(5); });
  S.charts.push(new Chart($('#fcW'), { data: { labels: [...ws.map((w) => w.slice(5)), ...fl], datasets: [{ type: 'bar', label: 'Actual', data: [...wv, null, null, null, null], backgroundColor: cssv('--acc'), borderRadius: 4 }, { type: 'bar', label: 'Forecast', data: [...ws.map(() => null), ...fc], backgroundColor: cssv('--prog'), borderRadius: 4 }, { type: 'line', label: 'Same week last year', data: [...ws.map((w) => { const d = new Date(w); d.setDate(d.getDate() - 364); return weeks[wk(d)] ?? null; }), ...[1, 2, 3, 4].map(lastYear)], borderColor: cssv('--soft'), borderDash: [5, 4], pointRadius: 0, spanGaps: true }] } }));
  S.charts.push(new Chart($('#fcL'), { type: 'bar', data: { labels: ms.map((m) => MN[+m.slice(5) - 1]), datasets: [{ data: leavers, backgroundColor: cssv('--danger'), borderRadius: 5 }] }, options: { plugins: { legend: { display: false } } } }));
  S.charts.push(new Chart($('#fcD'), { type: 'bar', data: { labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], datasets: [{ data: dow, backgroundColor: cssv('--unplanned'), borderRadius: 5 }] }, options: { plugins: { legend: { display: false } } } }));
  $('#fcAI').onclick = () => aiAsk('Explain these forecasts in plain English: expected covers next 4 weeks, staff turnover, and the top 5 high-risk contracts with the main reason for each. Suggest one action per item.');
  $$('[data-ra]').forEach((b) => (b.onclick = () => aiAsk(`Why is the contract "${b.dataset.ra}" scored as risky on this page, and what should I do first?`)));
}

/* ---------- csv export ---------- */
function downloadCsv(name, rows) {
  if (!rows.length) return; const cols = Object.keys(rows[0]);
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
}

if (cfg.SUPABASE_URL.includes('YOUR-PROJECT')) $('#app').innerHTML = '<div class="center"><div class="card login"><h2>Almost there</h2><p class="muted">Open config.js and paste your Supabase Project URL and anon key.</p></div></div>';
else if (location.hash.includes('type=invite') || location.hash.includes('type=recovery')) sb.auth.getSession().then(() => renderSetPassword());
else boot();
