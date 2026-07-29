-- ============================================================================
--  Migration: 2026-07-29  —  SECURITY: close the anonymous insert bypass
--  Applied to production on 2026-07-29. Run in: Supabase → SQL Editor.
--  Safe to re-run.
--
--  SEVERITY: high. Exploitable by anyone, no credentials beyond the public
--  anon key, which Supabase publishes by design.
--
--  WHAT WAS WRONG
--  --------------
--  Both policies were declared WITH CHECK (TRUE):
--
--    CREATE POLICY "Public can submit reviews"  ON reviews  FOR INSERT WITH CHECK (TRUE);
--    CREATE POLICY "Public can submit bookings" ON bookings FOR INSERT WITH CHECK (TRUE);
--
--  WITH CHECK (TRUE) accepts ANY row, including one that sets its own
--  moderation flags. Verified against the live project before the fix:
--
--    POST /rest/v1/reviews  {"client_name":"…","rating":5,"is_approved":true}
--      -> 201 Created
--    GET  /rest/v1/reviews?select=client_name,is_approved
--      -> 200 [{"client_name":"…","is_approved":true}]
--
--  The row was published on the homepage immediately, bypassing the API, the
--  moderation queue and the admin notification. Anonymous DELETE was correctly
--  refused (no DELETE policy), so an attacker could publish but not clean up.
--
--  On bookings the same policy allowed arbitrary rows straight into the
--  enquiry pipeline, around the honeypot, phone validation and rate limit.
--
--  WHY DROPPING THEM IS SAFE
--  -------------------------
--  Nothing legitimate used them. The frontend never talks to PostgREST; it
--  posts to the Express API, which authenticates with SUPABASE_SERVICE_KEY and
--  bypasses RLS entirely. Removing these policies makes the API the single
--  write path, so validation, rate limiting and moderation cannot be routed
--  around. Public SELECT policies are untouched — reading still works.
--
--  Both tables afterwards have RLS enabled with no INSERT policy, which
--  Supabase's linter reports as INFO 0008 (rls_enabled_no_policy). That is the
--  intended end state here, not an oversight.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS "Public can submit reviews"  ON reviews;
DROP POLICY IF EXISTS "Public can submit bookings" ON bookings;

COMMIT;

-- Verification (expect: only the public SELECT policies remain)
--   SELECT tablename, policyname, cmd, with_check
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename IN ('reviews','bookings');
