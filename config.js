// Supabase connection for the CRM.
// Fill these two values from: Supabase Dashboard → Project Settings → API
//   - Project URL            → SUPABASE_URL
//   - anon / public API key  → SUPABASE_ANON_KEY   (public by design; data is protected by RLS)
// NEVER put the service_role key here.
// While both are empty the CRM runs in local mode (data saved in this browser only).
window.CRM_CONFIG = {
  SUPABASE_URL: 'https://crcdvghkyointygnmsyp.supabase.co',
  SUPABASE_ANON_KEY: ''
};
