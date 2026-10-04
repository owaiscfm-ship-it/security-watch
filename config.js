/* SecureWatch — connection settings.
 * The site, guards, rota and logins now live on the server (Supabase, London), not in this file.
 * The "publishable" (anon) key is designed to be public: access is controlled by logins and
 * Row Level Security on the server. Never put the service_role / secret key here. */
window.SW_CONFIG = {
  version: '2.0.0',
  supabaseUrl: 'https://hauhcxdjsowgpjajivga.supabase.co',
  supabaseKey: 'd6910981ecf89090dff8cb3bcc98dd4035d201c40180db02',
  loginDomain: 'cfm-securewatch.local',
};
