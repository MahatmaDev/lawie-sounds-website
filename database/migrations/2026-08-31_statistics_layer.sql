-- ============================================================================
--  Migration: 2026-08-31  —  THE STATISTICS LAYER  (plan phase P2)
--  Safe to re-run.
--
--  WHY: this is where small-business dashboards go wrong, and the failure is
--  specific — they report ratios computed from a dozen data points as though
--  they were facts. If four of twelve enquiries convert, a dashboard says
--  "33%". That number is very nearly meaningless: the true rate is somewhere
--  between 14% and 61%, and next month's "improvement to 42%" will be noise.
--  An owner making pricing decisions on that is being actively misled by their
--  own tooling.
--
--  Three corrections, all computed here in SQL so the browser keeps doing no
--  arithmetic and every screen agrees about what a number means:
--
--    1. Every rate ships with a Wilson score interval. Wilson rather than the
--       normal approximation because it behaves properly near 0% and 100% and
--       at small n, which is exactly where this business lives.
--
--    2. Per-service leaderboards are shrunk toward the mean with an
--       empirical-Bayes Beta prior. Otherwise the table is topped forever by
--       whichever service had one enquiry and won it.
--
--    3. Pipeline value is an expectation with a band, not a sum. Adding up
--       quoted values and calling it "pipeline" is fantasy.
--
--  It also fixes a bug this table acquired yesterday: analytics_summary()
--  bucketed enquiries by created_at, which was correct only while every row
--  had enquired_at = created_at. The first backdated Quick Add would have made
--  a March enquiry count as an August arrival. Everything now buckets on
--  enquired_at, falling back to created_at for any row written before the
--  provenance migration.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
--  Wilson score interval
--
--    p̃ = (k + z²/2) / (n + z²)
--    w  = z/(n + z²) · √( k(n−k)/n + z²/4 )
--    CI = [p̃ − w, p̃ + w]
--
--  `reliable` is the honesty flag the dashboard greys out on: an interval
--  wider than ±15 points tells you almost nothing, and saying "not enough data
--  yet" beats a confident wrong number.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wilson_interval(k BIGINT, n BIGINT, z NUMERIC DEFAULT 1.96)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT CASE
    WHEN n IS NULL OR n <= 0 OR k IS NULL OR k < 0 OR k > n THEN
      jsonb_build_object(
        'n', coalesce(n, 0), 'k', coalesce(k, 0),
        'rate', NULL, 'low', NULL, 'high', NULL, 'halfWidth', NULL,
        'reliable', false)
    ELSE (
      WITH d AS (
        SELECT k::numeric AS kk, n::numeric AS nn, z::numeric AS zz
      ), e AS (
        SELECT kk, nn,
               (kk + zz*zz/2) / (nn + zz*zz)                                AS centre,
               (zz / (nn + zz*zz)) * sqrt(kk*(nn-kk)/nn + zz*zz/4)          AS w
          FROM d
      )
      SELECT jsonb_build_object(
        'n',         nn::bigint,
        'k',         kk::bigint,
        'rate',      round(kk/nn, 4),
        'low',       round(greatest(centre - w, 0), 4),
        'high',      round(least(centre + w, 1), 4),
        'halfWidth', round(w, 4),
        -- ±15 points is the line between "a number" and "a shrug".
        'reliable',  (w <= 0.15)
      ) FROM e
    )
  END
$$;

COMMENT ON FUNCTION public.wilson_interval(BIGINT, BIGINT, NUMERIC) IS
  'Wilson score interval for k successes in n trials. Returns rate, low, high, '
  'halfWidth and a reliable flag (halfWidth <= 0.15). Correct at small n and '
  'near 0/1, where the normal approximation is not.';

-- ----------------------------------------------------------------------------
--  analytics_summary — rebuilt on enquired_at, with the statistics layer added
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_summary(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_days      INT;
  v_prev_from DATE;
  v_prev_to   DATE;
  result      JSONB;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid date range: % to %', p_from, p_to;
  END IF;

  v_days      := (p_to - p_from) + 1;
  v_prev_to   := p_from - 1;
  v_prev_from := v_prev_to - (v_days - 1);

  WITH
  -- Bucketed on when the client got in touch, not when the row was written.
  -- coalesce for rows that predate the provenance migration.
  bk        AS (SELECT *, coalesce(enquired_at, created_at) AS arrived_at
                  FROM bookings
                 WHERE coalesce(enquired_at, created_at)::date BETWEEN p_from AND p_to),
  bk_prev   AS (SELECT *, coalesce(enquired_at, created_at) AS arrived_at
                  FROM bookings
                 WHERE coalesce(enquired_at, created_at)::date BETWEEN v_prev_from AND v_prev_to),
  won       AS (SELECT * FROM bk      WHERE status IN ('confirmed','completed')),
  won_prev  AS (SELECT * FROM bk_prev WHERE status IN ('confirmed','completed')),
  lost      AS (SELECT * FROM bk      WHERE status = 'cancelled'),
  open_bk   AS (SELECT * FROM bk      WHERE status = 'pending'),
  pay       AS (SELECT * FROM booking_payments WHERE paid_on BETWEEN p_from AND p_to),
  pay_prev  AS (SELECT * FROM booking_payments WHERE paid_on BETWEEN v_prev_from AND v_prev_to),
  cost      AS (SELECT * FROM payroll WHERE coalesce(event_date, created_at::date) BETWEEN p_from AND p_to),
  cost_prev AS (SELECT * FROM payroll WHERE coalesce(event_date, created_at::date) BETWEEN v_prev_from AND v_prev_to),
  days      AS (SELECT generate_series(p_from, p_to, '1 day'::interval)::date AS d),
  series    AS (
    SELECT d.d AS day,
           (SELECT count(*)                FROM bk  WHERE bk.arrived_at::date  = d.d) AS enquiries,
           (SELECT count(*)                FROM won WHERE won.arrived_at::date = d.d) AS won,
           (SELECT coalesce(sum(amount),0) FROM pay WHERE pay.paid_on = d.d)          AS collected
      FROM days d
  ),
  by_type AS (
    SELECT coalesce(nullif(trim(event_type), ''), 'Not specified') AS label,
           count(*) AS cnt,
           coalesce(sum(agreed_amount), 0) AS value
      FROM bk GROUP BY 1
  ),
  by_method AS (
    SELECT method AS label, sum(amount) AS total, count(*) AS cnt
      FROM pay GROUP BY method
  ),

  -- ── Per-service conversion ────────────────────────────────────────────
  -- Only enquiries that were actually decided count as trials. An enquiry
  -- still sitting open is not a loss, and counting it as one drags every
  -- rate down and makes a busy month look like a bad one.
  svc_raw AS (
    SELECT s.id, s.name, s.slug,
           count(DISTINCT b.id) FILTER (WHERE b.status <> 'pending')                      AS n,
           count(DISTINCT b.id) FILTER (WHERE b.status IN ('confirmed','completed'))      AS k,
           count(DISTINCT b.id) FILTER (WHERE b.status = 'pending')                       AS still_open
      FROM services s
      JOIN booking_services bs ON bs.service_id = s.id
      JOIN bk b                ON b.id = bs.booking_id
     GROUP BY s.id, s.name, s.slug
  ),

  -- ── The empirical-Bayes prior ─────────────────────────────────────────
  --   α + β = m(1−m)/v − 1,  α = m(α+β)
  -- fitted from the spread of the observed per-service rates. Services with
  -- plenty of history barely move; a service at 1-for-1 gets pulled to about
  -- average, where it belongs.
  prior_raw AS (
    SELECT avg(k::numeric / n)      AS m,
           var_samp(k::numeric / n) AS v,
           count(*)                 AS svc_count
      FROM svc_raw WHERE n > 0
  ),
  -- Guards, all of which happen in real data. Fewer than two services with
  -- history means there is no spread to fit. Zero variance — every service at
  -- the same rate — sends α+β to infinity. A degenerate fit is capped rather
  -- than trusted: past ~200 pseudo-observations the prior would overwhelm real
  -- evidence.
  --
  -- WHAT THE FALLBACK MUST NOT BE: the observed mean. On this database every
  -- decided enquiry was won, so m = 1.0, and a prior centred there gives
  -- α = 2, β = 0 and a shrunk rate of exactly 1.0 for a service that has won
  -- one enquiry out of one. That is the precise failure shrinkage exists to
  -- prevent, reintroduced by the guard meant to make it safe.
  --
  -- So the fallback is Beta(1,1) — uniform, weakly informative, agnostic. The
  -- shrunk rate becomes (k+1)/(n+2), Laplace's rule of succession: 1-for-1
  -- reads as 67%, 2-for-2 as 75%, and nothing reads as certain off a handful
  -- of observations.
  degenerate AS (
    SELECT (svc_count < 2 OR m IS NULL OR v IS NULL
            OR m <= 0 OR m >= 1 OR v <= 0
            OR (m*(1-m)/v - 1) <= 0) AS bad, m, v, svc_count
      FROM prior_raw
  ),
  prior AS (
    SELECT
      CASE WHEN bad THEN 0.5 ELSE m END                             AS m,
      CASE WHEN bad THEN 2.0 ELSE least(m*(1-m)/v - 1, 200.0) END   AS ab,
      svc_count,
      -- Stated plainly, so a reader can tell when shrinkage is doing the work
      -- because there was nothing to fit rather than because the data said so.
      bad AS is_fallback
      FROM degenerate
  ),
  svc AS (
    SELECT r.*,
           p.m AS prior_mean,
           p.m * p.ab       AS alpha,
           (1 - p.m) * p.ab AS beta,
           CASE WHEN r.n > 0 THEN round(r.k::numeric / r.n, 4) END AS raw_rate,
           -- NULL rather than the prior mean when nothing has been decided.
           -- The prior is what we believe about services in general; printing
           -- it in a column headed with this service's name would claim we had
           -- measured something we have not.
           CASE WHEN r.n > 0
                THEN round((r.k + p.m * p.ab) / (r.n + p.ab), 4) END AS shrunk_rate,
           wilson_interval(r.k, r.n)                                 AS interval
      FROM svc_raw r CROSS JOIN prior p
  ),

  -- ── Pipeline ──────────────────────────────────────────────────────────
  -- Each open enquiry is a Bernoulli trial with value vᵢ and win probability
  -- pᵢ. pᵢ is the shrunk rate of the services attached to it, so an enquiry
  -- for a service we rarely win is not counted at the same weight as one we
  -- usually do.
  open_valued AS (
    SELECT b.id,
           coalesce(
             b.agreed_amount,
             (SELECT sum(bs.quoted_price) FROM booking_services bs WHERE bs.booking_id = b.id),
             0
           )::numeric AS v,
           coalesce(
             (SELECT avg(sv.shrunk_rate)
                FROM booking_services bs2 JOIN svc sv ON sv.id = bs2.service_id
               WHERE bs2.booking_id = b.id),
             (SELECT m FROM prior)
           )::numeric AS p
      FROM open_bk b
  ),
  pipeline AS (
    SELECT count(*)                                        AS open_count,
           coalesce(sum(v), 0)                             AS gross,
           coalesce(sum(v * p), 0)                         AS expected,
           coalesce(sum(v * v * p * (1 - p)), 0)           AS variance,
           count(*) FILTER (WHERE v > 0)                   AS valued_count
      FROM open_valued
  ),

  -- ── Coverage ──────────────────────────────────────────────────────────
  -- What share of what we know about the client entered themselves. Shown
  -- permanently, because every rate above is computed over enquiries this
  -- system can see, and if a third of the real jobs never got typed in then
  -- these figures describe the website rather than the business.
  coverage AS (
    SELECT count(*)                                                   AS total,
           count(*) FILTER (WHERE coalesce(entry_mode,'self-serve') = 'self-serve')  AS self_serve,
           count(*) FILTER (WHERE coalesce(entry_mode,'self-serve') <> 'self-serve') AS staff_entered,
           count(*) FILTER (WHERE entry_channel IS NOT NULL AND entry_channel <> 'web-form') AS offline
      FROM bk
  ),
  -- Conversion within each entry mode, NEVER pooled. Staff-entered rows carry
  -- survivorship bias — nobody backfills the enquiries they lost — so a rate
  -- computed across both is inflated, and confidently so.
  conv_mode AS (
    SELECT coalesce(entry_mode, 'self-serve') AS mode,
           count(*) FILTER (WHERE status <> 'pending')                  AS n,
           count(*) FILTER (WHERE status IN ('confirmed','completed'))  AS k
      FROM bk GROUP BY 1
  )

  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_days,
                                 'previousFrom', v_prev_from, 'previousTo', v_prev_to,
                                 'basis', 'enquired_at'),
    'revenue', jsonb_build_object(
      'booked',        (SELECT coalesce(sum(agreed_amount),0) FROM won),
      'bookedPrev',    (SELECT coalesce(sum(agreed_amount),0) FROM won_prev),
      'collected',     (SELECT coalesce(sum(amount),0) FROM pay),
      'collectedPrev', (SELECT coalesce(sum(amount),0) FROM pay_prev),
      'outstanding',   (
        SELECT coalesce(sum(b.agreed_amount),0) - coalesce((
                 SELECT sum(p.amount) FROM booking_payments p
                  WHERE p.booking_id IN (SELECT id FROM bookings
                                          WHERE status IN ('confirmed','completed')
                                            AND agreed_amount IS NOT NULL)), 0)
          FROM bookings b
         WHERE b.status IN ('confirmed','completed') AND b.agreed_amount IS NOT NULL),
      'avgDeal',     (SELECT coalesce(round(avg(agreed_amount), 2), 0) FROM won      WHERE agreed_amount IS NOT NULL),
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

    -- ── NEW: conversion, with an interval and never pooled across modes ──
    'conversion', jsonb_build_object(
      'decided',  (SELECT count(*) FROM bk WHERE status <> 'pending'),
      'won',      (SELECT count(*) FROM won),
      'stillOpen',(SELECT count(*) FROM open_bk),
      'overall',  (SELECT wilson_interval(
                     (SELECT count(*) FROM won),
                     (SELECT count(*) FROM bk WHERE status <> 'pending'))),
      'byEntryMode', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'mode', mode, 'n', n, 'k', k,
                        'interval', wilson_interval(k, n)
                      ) ORDER BY n DESC), '[]'::jsonb) FROM conv_mode WHERE n > 0)
    ),

    -- ── NEW: per-service leaderboard, shrunk toward the mean ──
    'byService', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'id', id, 'name', name, 'slug', slug,
                    'enquiries', n, 'won', k, 'stillOpen', still_open,
                    'rawRate', raw_rate, 'shrunkRate', shrunk_rate,
                    'interval', interval
                  ) ORDER BY shrunk_rate DESC NULLS LAST, n DESC), '[]'::jsonb)
                  FROM svc WHERE n > 0 OR still_open > 0),
    'prior', (SELECT jsonb_build_object(
                'mean', round(m, 4), 'strength', round(ab, 2),
                'alpha', round(m*ab, 3), 'beta', round((1-m)*ab, 3),
                'servicesFitted', svc_count, 'isFallback', is_fallback)
                FROM prior),

    -- ── NEW: pipeline as an expectation with a band ──
    'pipeline', (SELECT jsonb_build_object(
                   'openCount',   open_count,
                   'valuedCount', valued_count,
                   'gross',       round(gross, 2),
                   'expected',    round(expected, 2),
                   'stdDev',      round(sqrt(variance), 2),
                   'low',         round(greatest(expected - 1.96 * sqrt(variance), 0), 2),
                   'high',        round(expected + 1.96 * sqrt(variance), 2),
                   -- Independence across unrelated clients is roughly true and
                   -- false in a seasonal spike, and the normal approximation is
                   -- weak below about ten open leads. Say so rather than
                   -- presenting the band as a guarantee.
                   'reliable',    (open_count >= 10 AND valued_count >= 10)
                 ) FROM pipeline),

    -- ── NEW: coverage ──
    'coverage', (SELECT jsonb_build_object(
                   'total', total, 'selfServe', self_serve, 'staffEntered', staff_entered,
                   'offlineChannels', offline,
                   'staffEnteredShare', CASE WHEN total > 0
                                             THEN round(staff_entered::numeric / total, 4) END
                 ) FROM coverage),

    'responsiveness', jsonb_build_object(
      -- Measured from when the client got in touch, not from when the row was
      -- written. On created_at, a months-old enquiry typed up this morning and
      -- answered an hour later reported a one-hour response time.
      'medianHours', (SELECT round(percentile_cont(0.5) WITHIN GROUP (
                        ORDER BY EXTRACT(EPOCH FROM (responded_at - arrived_at))/3600.0)::numeric, 1)
                        FROM bk WHERE responded_at IS NOT NULL),
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
    'series', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'day', day, 'enquiries', enquiries, 'won', won, 'collected', collected
               ) ORDER BY day), '[]'::jsonb) FROM series),
    'reviews', jsonb_build_object(
      'published', (SELECT count(*) FROM reviews WHERE status = 'published'),
      'average',   (SELECT round(avg(rating)::numeric, 1) FROM reviews WHERE status = 'published'),
      'pending',   (SELECT count(*) FROM reviews WHERE status = 'pending')
    ),
    'dataQuality', jsonb_build_object(
      'wonTotal',         (SELECT count(*) FROM won),
      'wonWithAmount',    (SELECT count(*) FROM won WHERE agreed_amount IS NOT NULL),
      'wonMissingAmount', (SELECT count(*) FROM won WHERE agreed_amount IS NULL),
      'paymentsRecorded', (SELECT count(*) FROM pay)
    )
  ) INTO result;

  RETURN result;
END;
$function$;

COMMIT;

-- ============================================================================
--  Verification
--
--    SELECT wilson_interval(4, 12);
--      -> rate 0.3333, low ~0.1378, high ~0.6104, reliable false
--
--    SELECT jsonb_pretty(analytics_summary('2026-01-01','2026-12-31'));
--
--  READ BEFORE QUOTING ANY FIGURE FROM THIS FUNCTION:
--  a rate whose interval carries reliable=false is not a small number, it is
--  an unknown one. Show it greyed, labelled "not enough data yet", and do not
--  let anyone plan pricing around it.
-- ============================================================================
