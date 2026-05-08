-- migration_phase_onboarding.sql
-- Round-10. First-login welcome flow.
--
-- Adds `profiles.onboarded_at timestamptz` — when null, the WelcomeOnboardingModal
-- prompts the user to set their nickname (full_name) and optionally change their
-- password. The Skip button still flips this to now() so the modal doesn't reappear.
-- Idempotent.

alter table public.profiles
  add column if not exists onboarded_at timestamptz;

-- Existing users (everyone in profiles before this migration ran) are
-- considered already onboarded. Otherwise the modal would pop for everyone
-- after deploy, which is annoying.
update public.profiles
   set onboarded_at = coalesce(onboarded_at, now())
 where onboarded_at is null;

-- Make sure RLS allows the user to read+update their own row's onboarded_at.
-- The base UPDATE policy on profiles already covers self-update for known
-- columns; if it's missing, add migration_phase_profile_self_update.sql first.

notify pgrst, 'reload schema';
