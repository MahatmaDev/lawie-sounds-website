-- ============================================================================
--  Migration: 2026-08-02  —  SERVICES: per-service price display policy
--  Safe to re-run.
--
--  WHY THIS EXISTS
--  ---------------
--  The concern raised was that a client with a small event sees a large package
--  price and leaves. That is a real effect. The proposed remedy was to remove
--  packages entirely.
--
--  Removing them would have cost more than it saved:
--    * the site would again have NO price anywhere, which loses the customers
--      who compare suppliers and pick whoever published one — a loss that
--      leaves no enquiry, no bounce and no trace in any dashboard
--    * revenue-per-package attribution and price history, both added the day
--      before, would become dead weight
--
--  The fear is about the ceiling; the remedy belongs at the floor. A visible,
--  genuinely low entry price is what tells a small-budget client they can
--  afford you. Silence makes them assume they cannot.
--
--  So the display becomes a policy, set per service, while packages remain the
--  data underneath:
--
--    from        show only the cheapest active package  "From KES 15,000"
--    range       show the span                          "KES 15,000 – 60,000"
--    on_request  show no figures at all
--
--  Under `on_request` the API omits prices from the PUBLIC PAYLOAD entirely
--  rather than leaving the frontend to hide them — a price hidden with CSS is
--  still sitting in the network response for anyone who opens developer tools.
-- ============================================================================

BEGIN;

ALTER TABLE services ADD COLUMN IF NOT EXISTS price_display TEXT NOT NULL DEFAULT 'from';

ALTER TABLE services DROP CONSTRAINT IF EXISTS services_price_display_check;
ALTER TABLE services ADD  CONSTRAINT services_price_display_check
  CHECK (price_display IN ('from', 'range', 'on_request'));

-- Sits beside the price to catch the exact client this is about, instead of
-- letting them bounce. Per service so the wording can be specific.
ALTER TABLE services ADD COLUMN IF NOT EXISTS budget_note TEXT;

UPDATE services
   SET budget_note = 'Smaller event? Tell us your budget and we will build something that fits.'
 WHERE budget_note IS NULL;

COMMIT;
