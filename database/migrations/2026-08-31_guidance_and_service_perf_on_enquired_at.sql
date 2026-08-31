-- ============================================================================
--  Migration: 2026-08-31 (b)  —  marketing_guidance() and service_performance()
--  onto enquired_at, and off a win rate that counts open enquiries as losses.
--  Safe to re-run.
--
--  Two bugs, one of which is actively harmful.
--
--  1. BOTH FUNCTIONS BUCKET ON created_at.
--     Correct only while every row had enquired_at = created_at, which stopped
--     being true the moment Quick Add shipped. A March enquiry typed up today
--     counts as an August arrival, so seasonality, trend and the 30-day
--     comparison windows are all wrong for any backfilled row.
--
--  2. THE WIN RATE DIVIDES BY ALL ENQUIRIES, INCLUDING OPEN ONES.
--     An enquiry awaiting a reply is not a loss. Counting it as one means the
--     figure falls every time enquiries arrive — the busier the month, the
--     worse the business appears to be doing.
--
--     In marketing_guidance() this is not merely wrong, it inverts the advice.
--     The current 30-day window is full of fresh, still-open enquiries; the
--     previous window has had time to mature. So the current rate is
--     structurally lower than the previous one, which is precisely the
--     condition the 'win-rate-falling' rule tests:
--
--         IF v_win_cur < v_win_prev - 10 THEN recommend a discount
--
--     The engine therefore tells the owner to cut prices *because enquiries
--     are arriving*. Measured on live data at the time of writing: 25% as
--     computed, against 100% over decided enquiries — a four-fold
--     understatement, entirely an artefact of three open enquiries.
--
--  Both now divide by decided enquiries only, matching the statistics layer in
--  2026-08-31_statistics_layer.sql. One definition of "win rate" across the
--  whole system; a second one would eventually disagree on the same screen.
--
--  Also fixed here: marketing_guidance() decided which services were "slow" by
--  matching service names against the bookings.services text[] and against
--  selected_package with ILIKE. That is the string-matching fragility the
--  booking_services table was created to end — a live booking said "Public
--  Address System" while the service is "Public Address Systems", and the
--  service was reported as having had no enquiries for 90 days. It now joins
--  booking_services on the real foreign key.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
--  service_performance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.service_performance(p_from DATE, p_to DATE)
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
  -- A booking carries ONE agreed_amount but may name several services. There is
  -- no honest way to know how that total divided, so it is split evenly across
  -- the services on the booking and the split is reported as an estimate. Where
  -- booking_services.quoted_price is recorded, that exact figure is used instead.
  attributed AS (
    SELECT bs.service_id,
           b.id     AS booking_id,
           b.status,
           -- When the client got in touch, not when the row was written.
           coalesce(b.enquired_at, b.created_at)::date AS arrived,
           coalesce(
             bs.quoted_price,
             CASE WHEN b.agreed_amount IS NOT NULL
                  THEN b.agreed_amount / NULLIF((SELECT count(*) FROM booking_services x WHERE x.booking_id = b.id), 0)
             END
           ) AS value,
           (bs.quoted_price IS NOT NULL) AS value_is_exact
      FROM booking_services bs
      JOIN bookings b ON b.id = bs.booking_id
  ),
  cur  AS (SELECT * FROM attributed WHERE arrived BETWEEN p_from AND p_to),
  prev AS (SELECT * FROM attributed WHERE arrived BETWEEN v_prev_from AND v_prev_to),
  collected AS (
    SELECT bs.service_id,
           sum(p.amount / NULLIF((SELECT count(*) FROM booking_services x WHERE x.booking_id = bs.booking_id), 0)) AS amt
      FROM booking_payments p
      JOIN booking_services bs ON bs.booking_id = p.booking_id
     WHERE p.paid_on BETWEEN p_from AND p_to
     GROUP BY bs.service_id
  ),
  per_service AS (
    SELECT s.id, s.slug, s.name, s.is_active, s.display_order, s.category, s.icon,
           (SELECT count(*) FROM cur  c  WHERE c.service_id  = s.id) AS enquiries,
           (SELECT count(*) FROM prev pr WHERE pr.service_id = s.id) AS enquiries_prev,
           -- Decided, not received. The denominator of a win rate can only
           -- contain enquiries that have actually been won or lost.
           (SELECT count(*) FROM cur  c  WHERE c.service_id  = s.id AND c.status  <> 'pending') AS decided,
           (SELECT count(*) FROM prev pr WHERE pr.service_id = s.id AND pr.status <> 'pending') AS decided_prev,
           (SELECT count(*) FROM cur  c  WHERE c.service_id  = s.id AND c.status  IN ('confirmed','completed')) AS won,
           (SELECT count(*) FROM prev pr WHERE pr.service_id = s.id AND pr.status IN ('confirmed','completed')) AS won_prev,
           (SELECT count(*) FROM cur  c  WHERE c.service_id  = s.id AND c.status  = 'pending') AS still_open,
           (SELECT coalesce(sum(c.value),0)  FROM cur  c  WHERE c.service_id  = s.id AND c.status  IN ('confirmed','completed')) AS booked,
           (SELECT coalesce(sum(pr.value),0) FROM prev pr WHERE pr.service_id = s.id AND pr.status IN ('confirmed','completed')) AS booked_prev,
           (SELECT coalesce(amt,0) FROM collected cl WHERE cl.service_id = s.id) AS collected,
           (SELECT bool_or(c.value_is_exact) FROM cur c WHERE c.service_id = s.id AND c.value IS NOT NULL) AS any_exact,
           h.has_short_desc, h.has_long_desc, h.has_image,
           h.package_count, h.priced_package_count, h.photo_count, h.feature_count, h.faq_count,
           (SELECT min(price) FROM service_packages sp WHERE sp.service_id = s.id AND sp.is_active AND sp.price IS NOT NULL) AS from_price,
           (SELECT max(price) FROM service_packages sp WHERE sp.service_id = s.id AND sp.is_active AND sp.price IS NOT NULL) AS top_price
      FROM services s
      JOIN service_content_health h ON h.id = s.id
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', v_days,
                                 'previousFrom', v_prev_from, 'previousTo', v_prev_to,
                                 'basis', 'enquired_at'),
    'totals', jsonb_build_object(
      'services',        (SELECT count(*) FROM services),
      'activeServices',  (SELECT count(*) FROM services WHERE is_active),
      'packages',        (SELECT count(*) FROM service_packages WHERE is_active),
      'pricedPackages',  (SELECT count(*) FROM service_packages WHERE is_active AND price IS NOT NULL),
      'enquiries',       (SELECT count(DISTINCT booking_id) FROM cur),
      'enquiriesPrev',   (SELECT count(DISTINCT booking_id) FROM prev),
      'booked',          (SELECT coalesce(sum(value),0) FROM cur  WHERE status IN ('confirmed','completed')),
      'bookedPrev',      (SELECT coalesce(sum(value),0) FROM prev WHERE status IN ('confirmed','completed')),
      'exactlyAttributed', (SELECT count(*) FROM cur WHERE value_is_exact),
      'evenlySplit',       (SELECT count(*) FROM cur WHERE NOT value_is_exact AND value IS NOT NULL)
    ),
    'services', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'slug', slug, 'name', name, 'isActive', is_active,
        'displayOrder', display_order, 'category', category, 'icon', icon,
        'enquiries', enquiries, 'enquiriesPrev', enquiries_prev,
        'decided', decided, 'stillOpen', still_open,
        'won', won, 'wonPrev', won_prev,
        'winRate',     CASE WHEN decided      > 0 THEN round(won::numeric      / decided      * 100) END,
        'winRatePrev', CASE WHEN decided_prev > 0 THEN round(won_prev::numeric / decided_prev * 100) END,
        -- The same interval the statistics layer uses, so this tab and the
        -- analytics tab cannot disagree about how sure we are.
        'interval', wilson_interval(won, decided),
        'booked', round(booked, 2), 'bookedPrev', round(booked_prev, 2),
        'collected', round(collected, 2),
        'valueIsExact', coalesce(any_exact, false),
        'fromPrice', from_price, 'topPrice', top_price,
        'content', jsonb_build_object(
          'shortDesc', has_short_desc, 'longDesc', has_long_desc, 'image', has_image,
          'packages', package_count, 'pricedPackages', priced_package_count,
          'photos', photo_count, 'features', feature_count, 'faqs', faq_count,
          -- A single readiness figure the tab can sort and colour by. Weighted so
          -- a price matters more than an FAQ: a client will leave over a missing
          -- price, not over a missing FAQ.
          'readiness', round((
              (CASE WHEN priced_package_count > 0 THEN 35 ELSE 0 END) +
              (CASE WHEN has_short_desc        THEN 15 ELSE 0 END) +
              (CASE WHEN has_long_desc         THEN 15 ELSE 0 END) +
              (CASE WHEN photo_count   >= 3    THEN 20 WHEN photo_count > 0 THEN 10 ELSE 0 END) +
              (CASE WHEN has_image             THEN  5 ELSE 0 END) +
              (CASE WHEN feature_count > 0     THEN  5 ELSE 0 END) +
              (CASE WHEN faq_count     > 0     THEN  5 ELSE 0 END)
          ))
        )
      ) ORDER BY booked DESC, enquiries DESC, display_order), '[]'::jsonb)
      FROM per_service
    )
  ) INTO result;

  RETURN result;
END;
$function$;

-- ----------------------------------------------------------------------------
--  marketing_guidance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marketing_guidance()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  recs            JSONB := '[]'::jsonb;
  v_today         DATE := CURRENT_DATE;
  v_cur_from      DATE := CURRENT_DATE - 29;
  v_prev_from     DATE := CURRENT_DATE - 59;
  v_prev_to       DATE := CURRENT_DATE - 30;
  v_enq_cur       INT;  v_enq_prev  INT;
  v_dec_cur       INT;  v_dec_prev  INT;
  v_won_cur       INT;  v_won_prev  INT;
  v_win_cur       NUMERIC; v_win_prev NUMERIC;
  v_upcoming      INT;  v_hist_rate NUMERIC; v_quiet_weeks JSONB;
  v_outstanding   NUMERIC; v_collected_30 NUMERIC; v_avg_deal NUMERIC;
  v_rating        NUMERIC; v_review_count INT;
  v_live_offers   INT;  v_stale_offers JSONB;
  v_banner_ctr    NUMERIC; v_banner_views INT;
  v_slow_services JSONB;
BEGIN
  -- Arrival is enquired_at, so a backfilled enquiry lands in the month the
  -- client actually got in touch rather than the month somebody typed it up.
  SELECT count(*) FILTER (WHERE TRUE),
         count(*) FILTER (WHERE status <> 'pending'),
         count(*) FILTER (WHERE status IN ('confirmed','completed'))
    INTO v_enq_cur, v_dec_cur, v_won_cur
    FROM bookings WHERE coalesce(enquired_at, created_at)::date BETWEEN v_cur_from AND v_today;

  SELECT count(*) FILTER (WHERE TRUE),
         count(*) FILTER (WHERE status <> 'pending'),
         count(*) FILTER (WHERE status IN ('confirmed','completed'))
    INTO v_enq_prev, v_dec_prev, v_won_prev
    FROM bookings WHERE coalesce(enquired_at, created_at)::date BETWEEN v_prev_from AND v_prev_to;

  -- Over DECIDED enquiries. Dividing by everything received made this fall
  -- whenever enquiries arrived, because the current window is full of leads
  -- nobody has answered yet while the previous window has had time to mature.
  -- That is a property of the calendar, not of the business, and it used to
  -- trigger a recommendation to discount.
  v_win_cur  := CASE WHEN v_dec_cur  > 0 THEN v_won_cur::numeric  / v_dec_cur  * 100 END;
  v_win_prev := CASE WHEN v_dec_prev > 0 THEN v_won_prev::numeric / v_dec_prev * 100 END;

  SELECT count(*) INTO v_upcoming FROM bookings
   WHERE status IN ('confirmed','completed') AND event_date BETWEEN v_today AND v_today + 60;

  SELECT CASE WHEN (max(event_date) - min(event_date)) >= 60
              THEN count(*)::numeric / ((max(event_date) - min(event_date))::numeric / 60) END
    INTO v_hist_rate FROM bookings
   WHERE status IN ('confirmed','completed') AND event_date IS NOT NULL AND event_date < v_today;

  SELECT coalesce(jsonb_agg(jsonb_build_object('weekStart', wk, 'confirmed', n) ORDER BY wk), '[]'::jsonb)
    INTO v_quiet_weeks FROM (
      SELECT gs::date AS wk,
             (SELECT count(*) FROM bookings b WHERE b.status IN ('confirmed','completed')
               AND b.event_date >= gs::date AND b.event_date < gs::date + 7) AS n
        FROM generate_series(date_trunc('week', v_today + 7), v_today + 56, '7 days') gs
    ) w WHERE n = 0;

  SELECT coalesce(sum(b.agreed_amount), 0) - coalesce((
           SELECT sum(p.amount) FROM booking_payments p
            WHERE p.booking_id IN (SELECT id FROM bookings
                                    WHERE status IN ('confirmed','completed') AND agreed_amount IS NOT NULL)), 0)
    INTO v_outstanding FROM bookings b
   WHERE b.status IN ('confirmed','completed') AND b.agreed_amount IS NOT NULL;

  SELECT coalesce(sum(amount), 0) INTO v_collected_30 FROM booking_payments WHERE paid_on BETWEEN v_cur_from AND v_today;
  SELECT round(avg(agreed_amount), 0) INTO v_avg_deal FROM bookings WHERE status IN ('confirmed','completed') AND agreed_amount IS NOT NULL;
  SELECT round(avg(rating)::numeric, 1), count(*) INTO v_rating, v_review_count FROM reviews WHERE status = 'published';
  SELECT count(*) INTO v_live_offers FROM offers WHERE is_active AND starts_on <= v_today AND (ends_on IS NULL OR ends_on >= v_today);

  SELECT coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'daysLive', v_today - starts_on)), '[]'::jsonb)
    INTO v_stale_offers FROM offers WHERE is_active AND times_redeemed = 0 AND starts_on <= v_today - 21;

  SELECT coalesce(sum(views), 0),
         CASE WHEN sum(views) > 0 THEN round(sum(clicks)::numeric / sum(views) * 100, 1) END
    INTO v_banner_views, v_banner_ctr FROM marketing_banners WHERE coalesce(views, 0) > 0;

  -- Joined on the real foreign key. This used to match service names against
  -- the bookings.services text[] and against selected_package with ILIKE, so a
  -- booking recorded as "Public Address System" never matched the service
  -- "Public Address Systems" and that service was reported as having had no
  -- enquiries for 90 days.
  SELECT coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'name', s.name)), '[]'::jsonb)
    INTO v_slow_services FROM services s
   WHERE s.is_active AND NOT EXISTS (
       SELECT 1 FROM booking_services bs
         JOIN bookings b ON b.id = bs.booking_id
        WHERE bs.service_id = s.id
          AND coalesce(b.enquired_at, b.created_at)::date >= v_today - 89);

  IF v_enq_cur + v_enq_prev < 10 THEN
    recs := recs || jsonb_build_object('id','insufficient-data','tone','neutral','priority',1,
      'title','Not enough trading history for discount advice yet',
      'signal', format('%s enquiries in the last 60 days', v_enq_cur + v_enq_prev),
      'action','Keep recording every enquiry and its agreed price. Advice here becomes meaningful at around 10 enquiries.',
      'why','Discount decisions made on a handful of enquiries are guesses. Two quiet weeks look identical to a downward trend at this sample size.',
      'confidence','low');
  END IF;

  IF v_outstanding > 0 AND v_outstanding > coalesce(v_collected_30, 0) THEN
    recs := recs || jsonb_build_object('id','collect-before-discount','tone','warning','priority',0,
      'title','Collect what you are owed before discounting',
      'signal', format('KES %s outstanding, against KES %s collected in 30 days',
                       to_char(v_outstanding,'FM999,999,999'), to_char(coalesce(v_collected_30,0),'FM999,999,999')),
      'action','Chase the unpaid balances first. Hold any new discount until the outstanding figure is below one month of collections.',
      'why','A discount reduces the value of future work while money from past work is still missing. Fixing collection raises cash without giving anything away.',
      'confidence','high');
  END IF;

  -- Gated on DECIDED counts in both windows. Five received enquiries of which
  -- one has been answered is not five data points, and this rule recommends
  -- giving away margin.
  IF v_dec_cur >= 5 AND v_dec_prev >= 5 AND v_win_cur IS NOT NULL AND v_win_prev IS NOT NULL
     AND v_win_cur < v_win_prev - 10 THEN
    recs := recs || jsonb_build_object('id','win-rate-falling','tone','opportunity','priority',2,
      'title','Win rate is dropping — a limited discount may convert more enquiries',
      'signal', format('%s%% of decided enquiries won this month (%s of %s) vs %s%% last month (%s of %s)',
                       round(v_win_cur), v_won_cur, v_dec_cur, round(v_win_prev), v_won_prev, v_dec_prev),
      'action', CASE WHEN v_avg_deal IS NOT NULL
                     THEN format('Try 10%% off (about KES %s on a typical job), capped at 10 redemptions, for 3 weeks.',
                                 to_char(round(v_avg_deal * 0.1),'FM999,999,999'))
                     ELSE 'Try 10% off, capped at 10 redemptions, for 3 weeks.' END,
      'why','Fewer of the enquiries you have answered are converting than last month, which usually means price is losing against a competitor. A capped, dated discount tests that without committing to a permanent cut.',
      'confidence', CASE WHEN v_dec_cur >= 20 THEN 'high' WHEN v_dec_cur >= 10 THEN 'medium' ELSE 'low' END);
  END IF;

  IF jsonb_array_length(v_quiet_weeks) > 0 THEN
    recs := recs || jsonb_build_object('id','quiet-weeks-ahead','tone','opportunity','priority',3,
      'title', format('%s week%s in the next two months have nothing booked',
                      jsonb_array_length(v_quiet_weeks),
                      CASE WHEN jsonb_array_length(v_quiet_weeks) = 1 THEN '' ELSE 's' END),
      'signal','Empty weeks starting: ' || (SELECT string_agg(to_char((e->>'weekStart')::date,'DD Mon'), ', ')
                                              FROM jsonb_array_elements(v_quiet_weeks) e),
      'action','Run a date-restricted offer for those specific weeks rather than an open discount. Idle equipment earns nothing, so a discounted booking beats an empty diary.',
      'why','A discount tied to dates you cannot otherwise fill costs you nothing in work you would have won anyway. An open-ended discount does.',
      'confidence','high','weeks', v_quiet_weeks);
  END IF;

  IF v_hist_rate IS NOT NULL AND v_hist_rate > 0 AND v_upcoming > v_hist_rate * 1.2 THEN
    recs := recs || jsonb_build_object('id','demand-strong','tone','caution','priority',2,
      'title','Demand is above normal — this is the wrong time to discount',
      'signal', format('%s jobs confirmed in the next 60 days, against a usual %s', v_upcoming, round(v_hist_rate)),
      'action','Hold your prices. If enquiries keep arriving for dates you are close to filling, test a higher quote instead.',
      'why','Discounting into strong demand gives money away on work you would have won at full price.',
      'confidence','medium');
  END IF;

  IF v_review_count >= 5 AND v_rating >= 4.5 THEN
    recs := recs || jsonb_build_object('id','compete-on-reputation','tone','neutral','priority',4,
      'title','Your ratings are strong enough to compete without discounting',
      'signal', format('%s average from %s published reviews', v_rating, v_review_count),
      'action','Put the rating and a client quote in the banner instead of a discount. Keep any price cut for genuinely quiet dates.',
      'why','Clients paying for an event they cannot re-run buy reassurance before price. Proof you deliver is cheaper to give than margin.',
      'confidence', CASE WHEN v_review_count >= 15 THEN 'high' ELSE 'medium' END);
  END IF;

  IF jsonb_array_length(v_stale_offers) > 0 THEN
    recs := recs || jsonb_build_object('id','stale-offers','tone','warning','priority',2,
      'title','Offers have been live for weeks with no redemptions',
      'signal', (SELECT string_agg(format('%s (%s days)', e->>'code', e->>'daysLive'), ', ')
                   FROM jsonb_array_elements(v_stale_offers) e),
      'action','Either promote them properly with a banner, or end them and try a different offer.',
      'why','A discount nobody knows about costs you nothing but teaches you nothing either. Left running, unused offers train returning clients to ignore your promotions.',
      'confidence','high','offers', v_stale_offers);
  END IF;

  IF v_live_offers = 0 AND NOT EXISTS (
       SELECT 1 FROM marketing_banners WHERE is_active
         AND (start_date IS NULL OR start_date <= v_today)
         AND (end_date IS NULL OR end_date >= v_today)) THEN
    recs := recs || jsonb_build_object('id','nothing-running','tone','neutral','priority',5,
      'title','Nothing is currently promoted on the website',
      'signal','No live offer and no live banner',
      'action','Even without a discount, put one banner up — an upcoming event, a service you want more of, or your rating.',
      'why','The homepage banner is the only place you speak to every visitor. Leaving it empty wastes the attention you already have.',
      'confidence','high');
  END IF;

  IF v_banner_views >= 200 AND v_banner_ctr IS NOT NULL AND v_banner_ctr < 1 THEN
    recs := recs || jsonb_build_object('id','low-ctr','tone','warning','priority',3,
      'title','Your banner is being seen but not clicked',
      'signal', format('%s%% click rate across %s views', v_banner_ctr, v_banner_views),
      'action','Rewrite the message around one specific benefit and a concrete number. Vague wording reads as decoration and gets ignored.',
      'why','Plenty of people are seeing it, so reach is not the problem — the message is.',
      'confidence','high');
  END IF;

  RETURN jsonb_build_object(
    'generatedAt', now(),
    'recommendations', (SELECT coalesce(jsonb_agg(r ORDER BY (r->>'priority')::int, r->>'id'), '[]'::jsonb)
                          FROM jsonb_array_elements(recs) r),
    'slowServices', v_slow_services,
    'signals', jsonb_build_object(
      'enquiries30', v_enq_cur, 'enquiriesPrev30', v_enq_prev,
      -- Both the rate and what it was computed over, so a reader can see that
      -- "100%" means one of one and treat it accordingly.
      'decided30', v_dec_cur, 'decidedPrev30', v_dec_prev,
      'won30', v_won_cur, 'wonPrev30', v_won_prev,
      'winRate30', CASE WHEN v_win_cur IS NULL THEN NULL ELSE round(v_win_cur) END,
      'winRatePrev30', CASE WHEN v_win_prev IS NULL THEN NULL ELSE round(v_win_prev) END,
      'winRateInterval', wilson_interval(v_won_cur::bigint, v_dec_cur::bigint),
      'upcoming60', v_upcoming, 'usualPer60', CASE WHEN v_hist_rate IS NULL THEN NULL ELSE round(v_hist_rate) END,
      'quietWeeks', jsonb_array_length(v_quiet_weeks),
      'outstanding', v_outstanding, 'collected30', coalesce(v_collected_30,0),
      'avgDeal', v_avg_deal, 'rating', v_rating, 'reviewCount', v_review_count,
      'liveOffers', v_live_offers, 'bannerViews', v_banner_views, 'bannerCtr', v_banner_ctr
    ));
END;
$function$;

COMMIT;

-- ============================================================================
--  Verification
--
--    SELECT marketing_guidance()->'signals';
--      -> winRate30 is now over decided30, not enquiries30
--
--    SELECT jsonb_pretty(service_performance(CURRENT_DATE-89, CURRENT_DATE));
--      -> every service carries decided, stillOpen and an interval
--
--    -- the 'win-rate-falling' rule must not fire on open enquiries alone
--    SELECT r->>'id' FROM jsonb_array_elements(marketing_guidance()->'recommendations') r;
-- ============================================================================
