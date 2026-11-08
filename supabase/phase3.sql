-- =====================================================================
-- Sudanese Schools CRM — Phase 3 migration: promo video link per campaign
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run   (safe to re-run)
-- =====================================================================
alter table public.campaigns add column if not exists video_url text
  check (video_url is null or video_url ~* '^https://');
