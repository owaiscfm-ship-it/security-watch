/* SecureWatch — connection settings.
 * The site, guards, rota and logins now live on the server (Supabase, London), not in this file.
 * The "publishable" (anon) key is designed to be public: access is controlled by logins and
 * Row Level Security on the server. Never put the service_role / secret key here. */
window.SW_CONFIG = {
  version: '2.0.0',
  supabaseUrl: 'https://hauhcxdjsowgpjajivga.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhdWhjeGRqc293Z3BqYWppdmdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4NTY1ODksImV4cCI6MjEwNjQzMjU4OX0.vZM6MN1KA5kOW9jlvv-6YUfRY4AWYgLahbkqmS9gORQ',
  loginDomain: 'cfm-securewatch.local',
};
