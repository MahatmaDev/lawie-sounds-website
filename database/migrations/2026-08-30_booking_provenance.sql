-- ============================================================================
--  Migration: 2026-08-30  —  BOOKING PROVENANCE (the three timestamps)
--  NOT YET APPLIED. Safe to re-run.
--
--  WHY: most of this business arrives by phone, by WhatsApp, and by somebody's
--  cousin. Only web enquiries were ever recorded, so every figure computed from
--  the bookings table was computed on a biased sample — and the bias points the
--  worst possible way: the website is the only channel anyone can see, so it
--  looks like the only channel that works, and the marketing money follows the
--  measurement instead of the customers.
--
--  Fixing that means letting staff enter the bookings the system never saw.
--  The moment they can, one timestamp stops being enough. A booking typed in
--  today for an enquiry that arrived in March must not appear in March's data
--  as though it were logged in March, and must not appear in today's arrival
--  rate at all. So there are three, and they answer three different questions:
--
--    enquired_at  when the client actually got in touch
--                 → arrival rate, seasonality, response time
--    entered_at   when a human typed it into this system
--                 → coverage and data-quality metrics
--    created_at   row creation, immutable, already here
--                 → audit only, never plotted
--
--  A self-serve web enquiry has all three within milliseconds of each other.
--  A backfilled one has enquired_at in March and entered_at today, and that
--  gap is itself the thing worth measuring.
--
--  NAMING NOTE — three columns, three distinct questions.
--  The plan called the arrival path "source", but this table already has two
--  columns in that neighbourhood and neither one is it:
--
--    source         free text from the form's "How did you hear about us?"
--                   field. The client's own words. Untouched here.
--    channel        which page drove the enquiry: 'booking-form' for a direct
--                   visit, or 'service:<slug>+<slug>' when they arrived from a
--                   service page. Live rows already carry the latter, and it is
--                   real attribution data. Untouched here.
--    entry_channel  NEW. How the enquiry reached us at all: the website form,
--                   a WhatsApp message, a phone call, somebody walking in.
--
--  An earlier draft of this migration tried to overload `channel` with the
--  arrival path. It would have failed its own CHECK constraint against five of
--  the six live rows, and the matching server change would have overwritten
--  every 'service:<slug>' value with 'web-form' — silently destroying the
--  attribution the business is already collecting. Hence a new column.
-- ============================================================================

BEGIN;

-- 1. The columns. All nullable at first so the backfill can run before any
--    constraint is enforced.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS enquired_at   TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS entered_at    TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS entry_mode    TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS entry_channel TEXT;

-- 2. Backfill. Every row that exists today came through the public booking
--    form — that is the only writer there has ever been — so for all of them
--    the client got in touch and the row was created at the same instant.
--    Using created_at rather than NOW() is the point: backdating history to
--    the moment of the migration would destroy the seasonality the new
--    columns exist to measure.
UPDATE bookings SET enquired_at = created_at WHERE enquired_at IS NULL;
UPDATE bookings SET entered_at  = created_at WHERE entered_at  IS NULL;
UPDATE bookings SET entry_mode  = 'self-serve' WHERE entry_mode IS NULL;

-- Every row that exists came through the public form, whichever page sent
-- them to it, so the arrival path for all of them is the website.
UPDATE bookings SET entry_channel = 'web-form' WHERE entry_channel IS NULL;

-- 3. Defaults, so a writer that forgets these columns still records something
--    true rather than a NULL that later has to be guessed at.
ALTER TABLE bookings ALTER COLUMN enquired_at   SET DEFAULT NOW();
ALTER TABLE bookings ALTER COLUMN entered_at    SET DEFAULT NOW();
ALTER TABLE bookings ALTER COLUMN entry_mode    SET DEFAULT 'self-serve';
ALTER TABLE bookings ALTER COLUMN entry_channel SET DEFAULT 'web-form';

-- 4. Vocabularies. Free text here would be fatal to the analytics within a
--    month: 'WhatsApp', 'whatsapp' and 'Whats app' are three channels to a
--    GROUP BY and one channel to a person.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_entry_mode_check;
ALTER TABLE bookings ADD  CONSTRAINT bookings_entry_mode_check
  CHECK (entry_mode IS NULL OR entry_mode IN ('self-serve', 'staff-entered', 'imported'));

-- Note this constrains entry_channel, NOT channel. `channel` stays free text
-- because it legitimately holds 'service:dj-mc-services+led-screens', which is
-- an open set — one value per combination of services a visitor can arrive
-- from. Constraining it would reject a row the site is designed to write.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_entry_channel_check;
ALTER TABLE bookings ADD  CONSTRAINT bookings_entry_channel_check
  CHECK (entry_channel IS NULL OR entry_channel IN
    ('web-form', 'whatsapp', 'phone', 'walk-in', 'referral', 'repeat', 'instagram', 'other'));

-- 5. An enquiry cannot be entered before it was made. This is the one ordering
--    that must hold for the arrival-rate figures to mean anything, and it is
--    exactly the mistake a hurried Quick Add makes — typing the event date into
--    the "when did they get in touch" field.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_enquired_before_entered;
ALTER TABLE bookings ADD  CONSTRAINT bookings_enquired_before_entered
  CHECK (enquired_at IS NULL OR entered_at IS NULL OR enquired_at <= entered_at + INTERVAL '1 minute');

-- 6. Indexes for the queries these columns exist to serve. enquired_at
--    replaces created_at as the axis every time series is plotted against, so
--    it needs the same index created_at already has.
CREATE INDEX IF NOT EXISTS idx_bookings_enquired_at ON bookings (enquired_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_entry_mode  ON bookings (entry_mode, enquired_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_entry_channel ON bookings (entry_channel, enquired_at DESC);

-- Duplicate detection for Quick Add: the same client phoning twice about the
-- same event should be caught before a second row is written.
CREATE INDEX IF NOT EXISTS idx_bookings_phone_recent ON bookings (phone, enquired_at DESC);

COMMIT;

-- ============================================================================
--  Verification
--
--    -- every row should now carry all three timestamps
--    SELECT COUNT(*) FILTER (WHERE enquired_at IS NULL) AS missing_enquired,
--           COUNT(*) FILTER (WHERE entered_at  IS NULL) AS missing_entered,
--           COUNT(*) FILTER (WHERE entry_mode  IS NULL) AS missing_mode
--      FROM bookings;
--
--    -- coverage: what share of what we know about was self-entered by the
--    -- client, versus typed in afterwards by someone here
--    SELECT entry_mode, entry_channel, COUNT(*),
--           ROUND(AVG(EXTRACT(EPOCH FROM (entered_at - enquired_at)) / 86400)::numeric, 1)
--             AS avg_days_to_enter
--      FROM bookings
--     GROUP BY entry_mode, entry_channel
--     ORDER BY COUNT(*) DESC;
--
--  READ THIS BEFORE PLOTTING ANYTHING FROM THIS TABLE:
--  staff-entered rows carry survivorship bias — nobody backfills the enquiries
--  they lost. A conversion rate computed over pooled self-serve and
--  staff-entered rows will be inflated, and confidently so. Compute within
--  entry_mode, never across it, and show the coverage ratio beside any figure
--  that is meant to describe the business rather than the website.
-- ============================================================================
