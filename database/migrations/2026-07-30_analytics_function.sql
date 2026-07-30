-- ============================================================================
--  Migration: 2026-07-30  —  ANALYTICS AGGREGATION FUNCTION
--  Safe to re-run (CREATE OR REPLACE).
--
--  WHY IN SQL RATHER THAN THE BROWSER
--  ----------------------------------
--  The old analytics tab pulled every booking, review, gallery row and banner
--  into the browser and did the arithmetic there. That is correct at one
--  booking and wrong as a design: transfer and compute both grow without
--  bound, the numbers depend on whichever pages the client happened to load,
--  and every consumer has to reimplement the same sums.
--
--  Aggregation belongs where the data is. One call, one pass, indexed.
--
--  ON "REALTIME": this computes from current rows on every call. There is no
--  materialised view and no cache, deliberately - at this data volume freshness
--  is free, and a stale financial figure is worse than a slow one. If the
--  dataset grows enough that this hurts, the fix is a materialised view
--  refreshed on a schedule, not client-side maths.
--
--  ON COMPARISON: growth is measured against the immediately preceding window
--  of EQUAL LENGTH. Comparing a 30-day window to a 31-day one manufactures a
--  3% swing out of the calendar, which is exactly the kind of artefact that
--  erodes trust in a dashboard.
-- ============================================================================

CREATE OR REPLACE FUNCTION analytics_summary(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_days     INT;
  v_prev_from DATE;
  v_prev_to   DATE;
  result     JSONB;
BEGIN
  -- Guard the window. A reversed range would silently return zeros, which
  -- reads as "the business made nothing" rather than "your dates are wrong".
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid date range: % to %', p_from, p_to;
  END IF;

  v_days      := (p_to - p_from) + 1;
  v_prev_to   := p_from - 1;
  v_prev_from := v_prev_to - (v_days - 1);

  WITH
  -- ---- current window -------------------------------------------------
  bk AS (
    SELECT * FROM bookings
     WHERE created_at::date BETWEEN p_from AND p_to
  ),
  bk_prev AS (
    SELECT * FROM bookings
     WHERE created_at::date BETWEEN v_prev_from AND v_prev_to
  ),
  -- Revenue is recognised on bookings that were actually won. Cancelled work
  -- is excluded everywhere - the old dashboard summed every row regardless of
  -- status, so a cancelled enquiry inflated the headline figure.
  won AS (
    SELECT * FROM bk WHERE status IN ('confirmed','completed')
  ),
  won_prev AS (
    SELECT * FROM bk_prev WHERE status IN ('confirmed','completed')
  ),
  -- Payments are attributed to the date the money arrived, not the date the
  -- booking was created. Cash flow and sales are different questions.
  pay AS (
    SELECT * FROM booking_payments WHERE paid_on BETWEEN p_from AND p_to
  ),
  pay_prev AS (
    SELECT * FROM booking_payments WHERE paid_on BETWEEN v_prev_from AND v_prev_to
  ),
  cost AS (
    SELECT * FROM payroll
     WHERE coalesce(event_date, created_at::date) BETWEEN p_from AND p_to
  ),
  cost_prev AS (
    SELECT * FROM payroll
     WHERE coalesce(event_date, created_at::date) BETWEEN v_prev_from AND v_prev_to
  ),
  -- Daily series, gap-filled. Without generate_series a quiet week simply
  -- vanishes from the chart and the line reconnects across it, which reads as
  -- continuous activity that never happened.
  days AS (
    SELECT generate_series(p_from, p_to, '1 day'::interval)::date AS d
  ),
  series AS (
    SELECT d.d AS day,
           (SELECT count(*)              FROM bk  WHERE bk.created_at::date = d.d)  AS enquiries,
           (SELECT count(*)              FROM won WHERE won.created_at::date = d.d) AS won,
           (SELECT coalesce(sum(amount),0) FROM pay WHERE pay.paid_on = d.d)        AS collected
      FROM days d
  ),
  -- Grouped in their own CTEs rather than inline. Building the jsonb object and
  -- then GROUP BY 1 groups by the object itself, which contains the aggregates
  -- - Postgres rejects that with "aggregate functions are not allowed in
  -- GROUP BY". Aggregate first, serialise second.
  by_type AS (
    SELECT coalesce(nullif(trim(event_type), ''), 'Not specified') AS label,
           count(*) AS cnt,
           coalesce(sum(agreed_amount), 0) AS value
      FROM bk GROUP BY 1
  ),
  by_method AS (
    SELECT method AS label, sum(amount) AS total, count(*) AS cnt
      FROM pay GROUP BY method
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object(
      'from', p_from, 'to', p_to, 'days', v_days,
      'previousFrom', v_prev_from, 'previousTo', v_prev_to
    ),

    'revenue', jsonb_build_object(
      -- What was agreed on work we won in this window.
      'booked',      (SELECT coalesce(sum(agreed_amount),0) FROM won),
      'bookedPrev',  (SELECT coalesce(sum(agreed_amount),0) FROM won_prev),
      -- What actually arrived in this window, regardless of when it was sold.
      'collected',   (SELECT coalesce(sum(amount),0) FROM pay),
      'collectedPrev',(SELECT coalesce(sum(amount),0) FROM pay_prev),
      -- Everything still owed across ALL time, not just this window - a debt
      -- from March is still outstanding in July.
      'outstanding', (
        SELECT coalesce(sum(b.agreed_amount),0) - coalesce((
                 SELECT sum(p.amount) FROM booking_payments p
                  WHERE p.booking_id IN (SELECT id FROM bookings
                                          WHERE status IN ('confirmed','completed')
                                            AND agreed_amount IS NOT NULL)), 0)
          FROM bookings b
         WHERE b.status IN ('confirmed','completed') AND b.agreed_amount IS NOT NULL
      ),
      'avgDeal',     (SELECT coalesce(round(avg(agreed_amount), 2), 0) FROM won WHERE agreed_amount IS NOT NULL),
      'avgDealPrev', (SELECT coalesce(round(avg(agreed_amount), 2), 0) FROM won_prev WHERE agreed_amount IS NOT NULL)
    ),

    'costs', jsonb_build_object(
      'payroll',     (SELECT coalesce(sum(amount),0) FROM cost),
      'payrollPrev', (SELECT coalesce(sum(amount),0) FROM cost_prev)
    ),

    'enquiries', jsonb_build_object(
      'total',     (SELECT count(*) FROM bk),
      'totalPrev', (SELECT count(*) FROM bk_prev),
      'pending',   (SELECT count(*) FROM bk WHERE status = 'pending'),
      'confirmed', (SELECT count(*) FROM bk WHERE status = 'confirmed'),
      'completed', (SELECT count(*) FROM bk WHERE status = 'completed'),
      'cancelled', (SELECT count(*) FROM bk WHERE status = 'cancelled'),
      'won',       (SELECT count(*) FROM won),
      'wonPrev',   (SELECT count(*) FROM won_prev)
    ),

    -- Median, not mean. One enquiry answered three weeks late would drag a
    -- mean past the point of being a useful description of normal service.
    'responsiveness', jsonb_build_object(
      'medianHours', (
        SELECT round(percentile_cont(0.5) WITHIN GROUP (
                 ORDER BY EXTRACT(EPOCH FROM (responded_at - created_at)) / 3600.0
               )::numeric, 1)
          FROM bk WHERE responded_at IS NOT NULL
      ),
      'answered',   (SELECT count(*) FROM bk WHERE responded_at IS NOT NULL),
      'unanswered', (SELECT count(*) FROM bk WHERE responded_at IS NULL AND status = 'pending')
    ),

    'breakdown', jsonb_build_object(
      'byEventType', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'label', label, 'count', cnt, 'value', value) ORDER BY cnt DESC), '[]'::jsonb)
                        FROM by_type),
      'byMethod',    (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'label', label, 'total', total, 'count', cnt) ORDER BY total DESC), '[]'::jsonb)
                        FROM by_method)
    ),

    'series', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'day', day, 'enquiries', enquiries, 'won', won, 'collected', collected
             ) ORDER BY day), '[]'::jsonb) FROM series
    ),

    'reviews', jsonb_build_object(
      'published', (SELECT count(*) FROM reviews WHERE status = 'published'),
      'average',   (SELECT round(avg(rating)::numeric, 1) FROM reviews WHERE status = 'published'),
      'pending',   (SELECT count(*) FROM reviews WHERE status = 'pending')
    ),

    -- How much of the revenue figure is actually backed by entered data. The
    -- dashboard shows this next to the money so the manager can tell the
    -- difference between "we earned little" and "nobody typed the amounts in".
    'dataQuality', jsonb_build_object(
      'wonTotal',        (SELECT count(*) FROM won),
      'wonWithAmount',   (SELECT count(*) FROM won WHERE agreed_amount IS NOT NULL),
      'wonMissingAmount',(SELECT count(*) FROM won WHERE agreed_amount IS NULL),
      'paymentsRecorded',(SELECT count(*) FROM pay)
    )
  ) INTO result;

  RETURN result;
END;
$$;

-- Only the service role calls this. Revoking the public grants keeps it off
-- /rest/v1/rpc/ for anon and signed-in users (Supabase lints 0028/0029).
REVOKE ALL ON FUNCTION analytics_summary(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION analytics_summary(DATE, DATE) FROM anon;
REVOKE ALL ON FUNCTION analytics_summary(DATE, DATE) FROM authenticated;
