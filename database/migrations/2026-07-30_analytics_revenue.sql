-- ============================================================================
--  Migration: 2026-07-30  —  ANALYTICS: a real money primitive
--  Run in: Supabase Dashboard → SQL Editor → New query → Run
--  Safe to re-run (fully idempotent).
--
--  WHY THIS EXISTS
--  ---------------
--  The analytics tab reported financial figures that had no financial data
--  behind them. Revenue was computed by mapping the client's self-declared
--  budget BRACKET to a hardcoded midpoint ('10k-30k' -> 20000) and multiplying
--  by row count. That is a guess at the middle of a range a stranger picked
--  from a dropdown before any quote existed, printed as "Pipeline Value".
--
--  Meanwhile bookings.total_amount was NULL on every row, payroll was empty,
--  and nothing anywhere recorded what a client actually agreed to pay or
--  actually paid.
--
--  You cannot report financial position without recording money. This adds the
--  smallest primitive that makes real reporting possible:
--
--    agreed_amount     what the client agreed to pay, entered once when the
--                      manager confirms the booking
--    booking_payments  each deposit/instalment actually received
--
--  From those two, everything the manager needs follows arithmetically:
--    booked revenue    = SUM(agreed_amount) of confirmed/completed
--    collected         = SUM(payments.amount)
--    outstanding       = booked - collected
--    costs             = SUM(payroll.amount)
--    net               = collected - costs
--
--  NOTE ON total_amount: that column already exists and means something else -
--  the public form writes ticketQuantity * event price into it for ticketed
--  events. Reusing it for service pricing would overload one column with two
--  meanings, so agreed_amount is separate and explicit.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. AGREED VALUE ON A BOOKING
-- ---------------------------------------------------------------------------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS agreed_amount NUMERIC(12,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS agreed_at     TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS agreed_by     TEXT;

-- Negative or absurd values are almost always a typo (a stray minus, or KES
-- entered in cents). Reject at the boundary rather than letting one row
-- poison every average on the dashboard.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_agreed_amount_check;
ALTER TABLE bookings ADD  CONSTRAINT bookings_agreed_amount_check
  CHECK (agreed_amount IS NULL OR (agreed_amount >= 0 AND agreed_amount <= 100000000));

-- ---------------------------------------------------------------------------
-- 2. PAYMENTS RECEIVED
--    A ledger, not a running total on the booking. A single "amount_paid"
--    column cannot answer "when did the money arrive?", which is exactly the
--    question a cash-flow view is made of - and it makes corrections
--    destructive. Rows are cheap; lost history is not.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS booking_payments (
  id          UUID          DEFAULT uuid_generate_v4() PRIMARY KEY,
  booking_id  UUID          NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0 AND amount <= 100000000),
  paid_on     DATE          NOT NULL DEFAULT CURRENT_DATE,
  method      TEXT          DEFAULT 'mpesa'
                            CHECK (method IN ('mpesa','cash','bank','cheque','other')),
  reference   TEXT,                       -- M-Pesa code, slip number, etc.
  note        TEXT,
  recorded_by TEXT,                       -- which admin entered it
  created_at  TIMESTAMPTZ   DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   DEFAULT NOW()
);

-- ON DELETE CASCADE above: payments belong to a booking and are meaningless
-- without it. Deleting the booking must not strand orphan money rows that
-- would keep inflating "collected" forever.

CREATE INDEX IF NOT EXISTS idx_payments_booking ON booking_payments (booking_id);
-- The cash-flow series groups by date, so that leads the index.
CREATE INDEX IF NOT EXISTS idx_payments_paid_on ON booking_payments (paid_on DESC);

DROP TRIGGER IF EXISTS trg_payments_updated_at ON booking_payments;
CREATE TRIGGER trg_payments_updated_at
  BEFORE UPDATE ON booking_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- An M-Pesa code identifies exactly one transaction. Recording it twice is a
-- double-count in every revenue figure, and it is an easy slip when the
-- manager is reconciling a stack of messages. Partial unique index so blank
-- references (cash, no slip) do not collide with each other.
DROP INDEX IF EXISTS idx_payments_unique_reference;
CREATE UNIQUE INDEX idx_payments_unique_reference
  ON booking_payments (upper(reference))
  WHERE reference IS NOT NULL AND reference <> '';

-- ---------------------------------------------------------------------------
-- 3. RLS
--    Financial data. No public policy of any kind: only the Express API,
--    holding the service key, may read or write this.
-- ---------------------------------------------------------------------------
ALTER TABLE booking_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public reads payments" ON booking_payments;
-- (deliberately no policies - service key bypasses RLS, anon gets nothing)

-- ---------------------------------------------------------------------------
-- 4. INDEXES FOR THE ANALYTICS QUERIES
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bookings_created_status ON bookings (created_at DESC, status);
CREATE INDEX IF NOT EXISTS idx_bookings_agreed        ON bookings (status, agreed_amount)
  WHERE agreed_amount IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_date           ON payroll (event_date DESC);

COMMIT;
