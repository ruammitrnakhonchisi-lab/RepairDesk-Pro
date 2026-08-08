// RepairDesk — Supabase connection config
// Get these from: Supabase Dashboard > Project Settings > API
// The "anon" key is a PUBLIC key by design (safe to ship in browser code) —
// access control is enforced by the Row Level Security policies in
// supabase/schema.sql, not by keeping this key secret.

window.SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
window.SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
