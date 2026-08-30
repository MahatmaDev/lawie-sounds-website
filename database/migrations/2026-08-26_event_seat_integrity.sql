-- ============================================================================
--  Migration: 2026-08-26  —  EVENT SEAT INTEGRITY
--  NOT YET APPLIED. Safe to re-run.
--
--  WHY: seats_left was allowed to exceed total_seats, and live rows did exceed
--  it — total_seats 100 against seats_left 120 and 200. total_seats defaults to
--  100 in this schema, so any event created without that column supplied got a
--  capacity smaller than its own remaining seats.
--
--  Tickets sold is derived as total_seats - seats_left, so those rows reported
--  negative sales. The Events tab of the dashboard showed "Tickets Sold -130"
--  and "Revenue Generated KES -435,000", the percentage-sold bar rendered a
--  negative width, and the "Sold Out" badge could never fire because it tested
--  seats_left === 0 against a number that had passed straight through zero.
--
--  server.js now clamps both columns on every write, and the dashboard clamps
--  again at display time. This repairs the rows already stored, and adds the
--  constraint that stops the state recurring by any other route — a direct SQL
--  edit, a restored backup, a future endpoint.
--
--  Seats already sold are preserved wherever the row is coherent. Where it is
--  not, capacity is raised to match what is recorded as remaining rather than
--  seats being silently destroyed: inventing sales the business never made is
--  worse than recording a room that is larger than someone typed.
-- ============================================================================

BEGIN;

-- 1. Repair. Only rows where seats_left exceeds total_seats are touched.
--    Raising total_seats to seats_left leaves "sold" at zero for these events,
--    which is the honest reading — nothing about them says a ticket was sold.
UPDATE events
   SET total_seats = seats_left
 WHERE seats_left IS NOT NULL
   AND total_seats IS NOT NULL
   AND seats_left > total_seats;

-- 2. Anything already oversold reads as sold out, not as negative stock.
UPDATE events
   SET seats_left = 0
 WHERE seats_left < 0;

UPDATE events
   SET total_seats = 0
 WHERE total_seats < 0;

-- 3. Make the state unrepresentable from here on. NULLs are still allowed:
--    an event with no seating plan is legitimate, and the check passes when
--    either side is NULL.
ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_seats_within_capacity;

ALTER TABLE events
  ADD CONSTRAINT events_seats_within_capacity
  CHECK (
    total_seats IS NULL
    OR seats_left IS NULL
    OR (total_seats >= 0 AND seats_left >= 0 AND seats_left <= total_seats)
  );

COMMIT;

-- Verification — every row should come back consistent, and the second query
-- should return no rows at all.
--
--   SELECT title, total_seats, seats_left, total_seats - seats_left AS sold
--     FROM events ORDER BY date;
--
--   SELECT id, title, total_seats, seats_left
--     FROM events
--    WHERE seats_left > total_seats OR seats_left < 0 OR total_seats < 0;
