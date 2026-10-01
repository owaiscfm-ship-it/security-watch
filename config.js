/* SecureWatch — connection settings.
 * The site, guards, rota and logins now live on the server (Supabase, London), not in this file.
 * The "publishable" (anon) key is designed to be public: access is controlled by logins and
 * Row Level Security on the server. Never put the service_role / secret key here. */
window.SW_CONFIG = {
  version: '2.0.0',
  supabaseUrl: 'https://hauhcxdjsowgpjajivga.supabase.co',
  supabaseKey: 'sb_publishable_KrARvUdRCWgk07MeGQrw-g_z-QBdLij',
  loginDomain: 'cfm-securewatch.local',
};
