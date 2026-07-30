-- ============================================================================
--  Migration: 2026-07-31  —  DISCOUNT GUIDANCE ENGINE
--  Safe to re-run (CREATE OR REPLACE).
--
--  WHAT THIS IS
--  ------------
--  The marketing tab is supposed to tell the manager when to discount. That is
--  only worth doing if the advice comes from what the business is actually
--  doing, so this reads the same rows the analytics tab reads and returns a
--  list of recommendations, each carrying:
--
--    signal      the measurement that triggered it
--    action      what to do, with concrete numbers
--    why         the reasoning, in plain language for a non-analyst
--    confidence  high | medium | low, driven by SAMPLE SIZE
--
--  DESIGN RULES
--  ------------
--  1. Never advise from a sample too small to mean anything. Two enquiries is
--     not a trend. Every rule states its own minimum and returns low confidence
--     or nothing at all below it. The previous "business health score" failed
--     exactly here - it reported 90% Healthy off a single booking.
--
--  2. Discounting is not always the answer, and a tool that only ever says
--     "discount more" is a liability. Rules can and do recommend AGAINST it:
--     when upcoming dates are already full, when money is uncollected, or when
--     ratings are strong enough to compete on quality instead.
--
--  3. Recommendations are advice, never automation. Nothing here changes a
--     price or activates an offer. A human decides.
-- ============================================================================

CREATE OR REPLACE FUNCTION marketing_guidance()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  recs            JSONB := '[]'::jsonb;
  v_today         DATE := CURRENT_DATE;
  -- Two 30-day windows for trend, and a 60-day forward look for capacity.
  v_cur_from      DATE := CURRENT_DATE - 29;
  v_prev_from     DATE := CURRENT_DATE - 59;
  v_prev_to       DATE := CURRENT_DATE - 30;

  v_enq_cur       INT;
  v_enq_prev      INT;
  v_won_cur       INT;
  v_won_prev      INT;
  v_win_cur       NUMERIC;
  v_win_prev      NUMERIC;

  v_upcoming      INT;      -- confirmed jobs in the next 60 days
  v_hist_rate     NUMERIC;  -- historical confirmed jobs per 60 days
  v_quiet_weeks   JSONB;

  v_outstanding   NUMERIC;
  v_collected_30  NUMERIC;
  v_avg_deal      NUMERIC;

  v_rating        NUMERIC;
  v_review_count  INT;

  v_live_offers   INT;
  v_stale_offers  JSONB;
  v_banner_ctr    NUMERIC;
  v_banner_views  INT;

  v_slow_services JSONB;
BEGIN
  ---------------------------------------------------------------------------
  -- Gather the signals
  ---------------------------------------------------------------------------
  SELECT count(*) INTO v_enq_cur  FROM bookings WHERE created_at::date BETWEEN v_cur_from  AND v_today;
  SELECT count(*) INTO v_enq_prev FROM bookings WHERE created_at::date BETWEEN v_prev_from AND v_prev_to;
  SELECT count(*) INTO v_won_cur  FROM bookings WHERE created_at::date BETWEEN v_cur_from  AND v_today
                                                  AND status IN ('confirmed','completed');
  SELECT count(*) INTO v_won_prev FROM bookings WHERE created_at::date BETWEEN v_prev_from AND v_prev_to
                                                  AND status IN ('confirmed','completed');

  v_win_cur  := CASE WHEN v_enq_cur  > 0 THEN v_won_cur::numeric  / v_enq_cur  * 100 END;
  v_win_prev := CASE WHEN v_enq_prev > 0 THEN v_won_prev::numeric / v_enq_prev * 100 END;

  SELECT count(*) INTO v_upcoming
    FROM bookings
   WHERE status IN ('confirmed','completed')
     AND event_date BETWEEN v_today AND v_today + 60;

  -- Historical throughput, normalised to a 60-day window, from whatever history
  -- exists. Comparing "next 60 days" against an all-time average per 60 days is
  -- the only comparison available before a full year of trading.
  SELECT CASE WHEN (max(event_date) - min(event_date)) >= 60
              THEN count(*)::numeric / ((max(event_date) - min(event_date))::numeric / 60)
         END
    INTO v_hist_rate
    FROM bookings
   WHERE status IN ('confirmed','completed') AND event_date IS NOT NULL AND event_date < v_today;

  -- Which specific upcoming weeks are empty. Naming the dates is what turns
  -- "business is quiet" into something a marketer can actually promote.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'weekStart', wk, 'confirmed', n) ORDER BY wk), '[]'::jsonb)
    INTO v_quiet_weeks
    FROM (
      SELECT gs::date AS wk,
             (SELECT count(*) FROM bookings b
               WHERE b.status IN ('confirmed','completed')
                 AND b.event_date >= gs::date AND b.event_date < gs::date + 7) AS n
        FROM generate_series(date_trunc('week', v_today + 7), v_today + 56, '7 days') gs
    ) w
   WHERE n = 0;

  SELECT coalesce(sum(b.agreed_amount), 0) - coalesce((
           SELECT sum(p.amount) FROM booking_payments p
            WHERE p.booking_id IN (SELECT id FROM bookings
                                    WHERE status IN ('confirmed','completed')
                                      AND agreed_amount IS NOT NULL)), 0)
    INTO v_outstanding
    FROM bookings b
   WHERE b.status IN ('confirmed','completed') AND b.agreed_amount IS NOT NULL;

  SELECT coalesce(sum(amount), 0) INTO v_collected_30
    FROM booking_payments WHERE paid_on BETWEEN v_cur_from AND v_today;

  SELECT round(avg(agreed_amount), 0) INTO v_avg_deal
    FROM bookings WHERE status IN ('confirmed','completed') AND agreed_amount IS NOT NULL;

  SELECT round(avg(rating)::numeric, 1), count(*) INTO v_rating, v_review_count
    FROM reviews WHERE status = 'published';

  SELECT count(*) INTO v_live_offers
    FROM offers WHERE is_active AND starts_on <= v_today AND (ends_on IS NULL OR ends_on >= v_today);

  -- Offers that ran and nobody used. Left live, they train clients to ignore
  -- promotions; that is worse than having none.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'code', code, 'label', label, 'daysLive', v_today - starts_on)), '[]'::jsonb)
    INTO v_stale_offers
    FROM offers
   WHERE is_active AND times_redeemed = 0 AND starts_on <= v_today - 21;

  SELECT coalesce(sum(views), 0),
         CASE WHEN sum(views) > 0 THEN round(sum(clicks)::numeric / sum(views) * 100, 1) END
    INTO v_banner_views, v_banner_ctr
    FROM marketing_banners
   WHERE coalesce(views, 0) > 0;

  -- Services attracting no interest at all in 90 days, ignoring ones switched
  -- off deliberately. bookings.services is a text[] of service NAMES (that is
  -- what the public form submits), so match on name rather than slug.
  SELECT coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name)), '[]'::jsonb)
    INTO v_slow_services
    FROM services s
   WHERE s.is_active
     AND NOT EXISTS (
       SELECT 1 FROM bookings b
        WHERE b.created_at::date >= v_today - 89
          AND (
            (b.services IS NOT NULL AND s.name = ANY (b.services))
            OR b.selected_package ILIKE '%' || s.name || '%'
          )
     );

  ---------------------------------------------------------------------------
  -- Turn signals into recommendations
  ---------------------------------------------------------------------------

  -- RULE 1: too little trading history to advise on anything.
  IF v_enq_cur + v_enq_prev < 10 THEN
    recs := recs || jsonb_build_object(
      'id', 'insufficient-data', 'tone', 'neutral', 'priority', 1,
      'title', 'Not enough trading history for discount advice yet',
      'signal', format('%s enquiries in the last 60 days', v_enq_cur + v_enq_prev),
      'action', 'Keep recording every enquiry and its agreed price. Advice here becomes meaningful at around 10 enquiries.',
      'why', 'Discount decisions made on a handful of enquiries are guesses. Two quiet weeks look identical to a downward trend at this sample size.',
      'confidence', 'low');
  END IF;

  -- RULE 2: uncollected money outranks any promotion.
  IF v_outstanding > 0 AND v_outstanding > coalesce(v_collected_30, 0) THEN
    recs := recs || jsonb_build_object(
      'id', 'collect-before-discount', 'tone', 'warning', 'priority', 0,
      'title', 'Collect what you are owed before discounting',
      'signal', format('KES %s outstanding, against KES %s collected in 30 days',
                       to_char(v_outstanding, 'FM999,999,999'), to_char(coalesce(v_collected_30,0), 'FM999,999,999')),
      'action', 'Chase the unpaid balances first. Hold any new discount until the outstanding figure is below one month of collections.',
      'why', 'A discount reduces the value of future work while money from past work is still missing. Fixing collection raises cash without giving anything away.',
      'confidence', 'high');
  END IF;

  -- RULE 3: win rate falling -> price resistance.
  IF v_enq_cur >= 5 AND v_enq_prev >= 5 AND v_win_cur IS NOT NULL AND v_win_prev IS NOT NULL
     AND v_win_cur < v_win_prev - 10 THEN
    recs := recs || jsonb_build_object(
      'id', 'win-rate-falling', 'tone', 'opportunity', 'priority', 2,
      'title', 'Win rate is dropping — a limited discount may convert more enquiries',
      'signal', format('%s%% of enquiries won this month vs %s%% last month',
                       round(v_win_cur), round(v_win_prev)),
      'action', CASE WHEN v_avg_deal IS NOT NULL
                     THEN format('Try 10%% off (about KES %s on a typical job), capped at 10 redemptions, for 3 weeks.',
                                 to_char(round(v_avg_deal * 0.1), 'FM999,999,999'))
                     ELSE 'Try 10% off, capped at 10 redemptions, for 3 weeks.' END,
      'why', 'Fewer enquiries are converting than last month, which usually means price is losing against a competitor. A capped, dated discount tests that without committing to a permanent cut.',
      'confidence', CASE WHEN v_enq_cur >= 20 THEN 'high' WHEN v_enq_cur >= 10 THEN 'medium' ELSE 'low' END);
  END IF;

  -- RULE 4: specific empty weeks ahead.
  IF jsonb_array_length(v_quiet_weeks) > 0 THEN
    recs := recs || jsonb_build_object(
      'id', 'quiet-weeks-ahead', 'tone', 'opportunity', 'priority', 3,
      'title', format('%s week%s in the next two months have nothing booked',
                      jsonb_array_length(v_quiet_weeks),
                      CASE WHEN jsonb_array_length(v_quiet_weeks) = 1 THEN '' ELSE 's' END),
      'signal', 'Empty weeks starting: ' || (
        SELECT string_agg(to_char((e->>'weekStart')::date, 'DD Mon'), ', ')
          FROM jsonb_array_elements(v_quiet_weeks) e),
      'action', 'Run a date-restricted offer for those specific weeks rather than an open discount. Idle equipment earns nothing, so a discounted booking beats an empty diary.',
      'why', 'A discount tied to dates you cannot otherwise fill costs you nothing in work you would have won anyway. An open-ended discount does.',
      'confidence', 'high', 'weeks', v_quiet_weeks);
  END IF;

  -- RULE 5: already busy -> do NOT discount.
  IF v_hist_rate IS NOT NULL AND v_hist_rate > 0 AND v_upcoming > v_hist_rate * 1.2 THEN
    recs := recs || jsonb_build_object(
      'id', 'demand-strong', 'tone', 'caution', 'priority', 2,
      'title', 'Demand is above normal — this is the wrong time to discount',
      'signal', format('%s jobs confirmed in the next 60 days, against a usual %s',
                       v_upcoming, round(v_hist_rate)),
      'action', 'Hold your prices. If enquiries keep arriving for dates you are close to filling, test a higher quote instead.',
      'why', 'Discounting into strong demand gives money away on work you would have won at full price.',
      'confidence', 'medium');
  END IF;

  -- RULE 6: strong reputation is leverage other than price.
  IF v_review_count >= 5 AND v_rating >= 4.5 THEN
    recs := recs || jsonb_build_object(
      'id', 'compete-on-reputation', 'tone', 'neutral', 'priority', 4,
      'title', 'Your ratings are strong enough to compete without discounting',
      'signal', format('%s average from %s published reviews', v_rating, v_review_count),
      'action', 'Put the rating and a client quote in the banner instead of a discount. Keep any price cut for genuinely quiet dates.',
      'why', 'Clients paying for an event they cannot re-run buy reassurance before price. Proof you deliver is cheaper to give than margin.',
      'confidence', CASE WHEN v_review_count >= 15 THEN 'high' ELSE 'medium' END);
  END IF;

  -- RULE 7: offers running that nobody uses.
  IF jsonb_array_length(v_stale_offers) > 0 THEN
    recs := recs || jsonb_build_object(
      'id', 'stale-offers', 'tone', 'warning', 'priority', 2,
      'title', 'Offers have been live for weeks with no redemptions',
      'signal', (SELECT string_agg(format('%s (%s days)', e->>'code', e->>'daysLive'), ', ')
                   FROM jsonb_array_elements(v_stale_offers) e),
      'action', 'Either promote them properly with a banner, or end them and try a different offer.',
      'why', 'A discount nobody knows about costs you nothing but teaches you nothing either. Left running, unused offers train returning clients to ignore your promotions.',
      'confidence', 'high', 'offers', v_stale_offers);
  END IF;

  -- RULE 8: no offer and no banner at all.
  IF v_live_offers = 0 AND NOT EXISTS (
       SELECT 1 FROM marketing_banners
        WHERE is_active AND (start_date IS NULL OR start_date <= v_today)
                        AND (end_date IS NULL OR end_date >= v_today)) THEN
    recs := recs || jsonb_build_object(
      'id', 'nothing-running', 'tone', 'neutral', 'priority', 5,
      'title', 'Nothing is currently promoted on the website',
      'signal', 'No live offer and no live banner',
      'action', 'Even without a discount, put one banner up — an upcoming event, a service you want more of, or your rating.',
      'why', 'The homepage banner is the only place you speak to every visitor. Leaving it empty wastes the attention you already have.',
      'confidence', 'high');
  END IF;

  -- RULE 9: banners seen but not clicked.
  IF v_banner_views >= 200 AND v_banner_ctr IS NOT NULL AND v_banner_ctr < 1 THEN
    recs := recs || jsonb_build_object(
      'id', 'low-ctr', 'tone', 'warning', 'priority', 3,
      'title', 'Your banner is being seen but not clicked',
      'signal', format('%s%% click rate across %s views', v_banner_ctr, v_banner_views),
      'action', 'Rewrite the message around one specific benefit and a concrete number. Vague wording reads as decoration and gets ignored.',
      'why', 'Plenty of people are seeing it, so reach is not the problem — the message is.',
      'confidence', 'high');
  END IF;

  RETURN jsonb_build_object(
    'generatedAt', now(),
    'recommendations', (
      SELECT coalesce(jsonb_agg(r ORDER BY (r->>'priority')::int, r->>'id'), '[]'::jsonb)
        FROM jsonb_array_elements(recs) r
    ),
    'signals', jsonb_build_object(
      'enquiries30',      v_enq_cur,
      'enquiriesPrev30',  v_enq_prev,
      'winRate30',        CASE WHEN v_win_cur  IS NULL THEN NULL ELSE round(v_win_cur)  END,
      'winRatePrev30',    CASE WHEN v_win_prev IS NULL THEN NULL ELSE round(v_win_prev) END,
      'upcoming60',       v_upcoming,
      'usualPer60',       CASE WHEN v_hist_rate IS NULL THEN NULL ELSE round(v_hist_rate) END,
      'quietWeeks',       jsonb_array_length(v_quiet_weeks),
      'outstanding',      v_outstanding,
      'collected30',      coalesce(v_collected_30, 0),
      'avgDeal',          v_avg_deal,
      'rating',           v_rating,
      'reviewCount',      v_review_count,
      'liveOffers',       v_live_offers,
      'bannerViews',      v_banner_views,
      'bannerCtr',        v_banner_ctr
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION marketing_guidance() FROM PUBLIC;
REVOKE ALL ON FUNCTION marketing_guidance() FROM anon;
REVOKE ALL ON FUNCTION marketing_guidance() FROM authenticated;
