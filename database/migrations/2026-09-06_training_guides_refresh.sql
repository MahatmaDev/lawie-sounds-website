-- ============================================================================
--  Migration: 2026-09-06  —  TRAINING GUIDES, REWRITTEN FOR BOTH ACCOUNTS
--  Safe to re-run (every write is an upsert keyed on slug).
--
--  WHAT THIS IS
--  ------------
--  The Training tab reads training_guides. It shipped with five sections, four
--  of them audience 'manager' and one 'admin', written before the Work, Albums,
--  Analytics and Marketing tabs reached their current shape.
--
--  Two problems that follow from that:
--
--  1. AUDIENCE. The server filters this table for managers only
--     (audience IN ('manager','both')); the owner is sent everything. So an
--     'admin' guide is invisible to the manager while a 'manager' guide is
--     visible to both. The Services guide was 'admin' — a guide for a tab the
--     manager can open and use, that the manager could not read. Anything both
--     accounts do is now 'both', and 'admin' is reserved for what the manager's
--     screen genuinely does not contain: money, staff records, the work log.
--
--  2. COVERAGE. Events, Work, Client Albums and Analytics had no guide at all,
--     which is half the tabs the manager uses daily. They are added here, in
--     the order the tabs appear on screen.
--
--  Every section also names who to call when it goes wrong, and the last one
--  exists only to carry those numbers — the office line and the developer's,
--  +254 711 939 907. "Ask the developer" is not useful advice without a number
--  attached to it.
--
--  STYLE RULES (kept from the original five)
--  -----------------------------------------
--  - A step is one action with one outcome. Title is the action; body is what
--    happens, or the one thing that goes wrong if it is skipped.
--  - Say what the screen actually says. If a button is labelled "Advertise",
--    the guide says Advertise.
--  - No numbers that will rot. "Only the highest-priority live banner shows" is
--    a rule; "there are three banners" is a fact with a shelf life.
-- ============================================================================

BEGIN;

-- Guides are addressed by slug from here on, so make that explicit.
CREATE UNIQUE INDEX IF NOT EXISTS training_guides_slug_key ON training_guides (slug);

-- ── The upsert ──────────────────────────────────────────────────────────────
-- last_reviewed_on is stamped today: the tab flags a guide as stale after 120
-- days, and that warning is only worth anything if a rewrite resets the clock.
INSERT INTO training_guides (slug, title, intro, icon, audience, display_order, is_published, steps, last_reviewed_on, updated_by)
VALUES

-- ── 10. Enquiries ───────────────────────────────────────────────────────────
('enquiries',
 'Enquiries — replying, and recording what was agreed',
 'Every enquiry from the website lands here. The promise on the site is a reply within 2 hours, and this tab is the only place that clock is kept.',
 'fa-inbox', 'both', 10, TRUE,
 '[
   {"n":1,"title":"Work the top of the list first","body":"Anything past the 2-hour promise is flagged red. The list sorts by what is most overdue, not by what arrived last."},
   {"n":2,"title":"Open it and use the Call or WhatsApp button","body":"Both are at the top of the panel and dial the number the client actually gave, so nothing is mistyped."},
   {"n":3,"title":"Move the status as things progress","body":"Pending, confirmed, completed or cancelled. The first move off pending is what records your response time — leaving it on pending records a miss even after you have called."},
   {"n":4,"title":"Add an enquiry that came in by phone or WhatsApp","body":"Use Quick Add and set the date the client first got in touch, not today. The response clock runs from when they contacted you."},
   {"n":5,"title":"Record the agreed price","body":"In the Money section, enter what the client agreed to pay. Every revenue figure in the system is built from this one field."},
   {"n":6,"title":"Record each payment as it arrives","body":"Amount, method and M-Pesa code. The same code cannot be entered twice, so a double-entry is caught rather than counted."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 20. Events ──────────────────────────────────────────────────────────────
('events',
 'Events — what is coming up, and tickets',
 'The public events list on the website is this tab. An event stays visible to visitors until its date passes.',
 'fa-calendar-alt', 'both', 20, TRUE,
 '[
   {"n":1,"title":"Add the event before you promote it anywhere else","body":"The homepage, the events page and the enquiry form all read from here. Posting a poster for an event that is not in this list sends people to a page that does not mention it."},
   {"n":2,"title":"Fill in the date, venue and ticket price","body":"An event with no date cannot be sorted into upcoming, so it quietly drops out of the public list."},
   {"n":3,"title":"Use Duplicate for a recurring night","body":"It copies everything and leaves the date blank, which is the only field that genuinely changes."},
   {"n":4,"title":"Keep tickets sold up to date","body":"That figure is what the tab totals. If nobody updates it after the night, the totals describe sales rather than the event."},
   {"n":5,"title":"Leave past events in place","body":"They move to Past automatically and are what the Work tab and the gallery are built from. Deleting one erases the record of a job you delivered."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 30. Gallery ─────────────────────────────────────────────────────────────
('gallery',
 'Gallery — uploading and organising photos',
 'The gallery is the portfolio clients browse before they enquire. Upload after every event, while you still remember which photos are the good ones.',
 'fa-images', 'both', 30, TRUE,
 '[
   {"n":1,"title":"Upload straight from the camera roll","body":"Several at once is fine. Large photos are resized for the web automatically — do not shrink them first, the original is what future sizes are cut from."},
   {"n":2,"title":"Tag each photo to the event it came from","body":"An untagged photo can still be seen, but it will not appear on that event''s page in the Work tab."},
   {"n":3,"title":"Publish only the ones you would show a client","body":"Everything uploaded is private until published. Twenty strong photos sell better than two hundred ordinary ones."},
   {"n":4,"title":"Feature a handful","body":"Featured photos are what the homepage rotates. Change them when the work changes, not once a year."},
   {"n":5,"title":"Use the checkboxes for bulk work","body":"Publishing, featuring and deleting all work on a selection, which is far quicker than opening each photo."},
   {"n":6,"title":"Never upload a photo of a client you have not asked","body":"Client work goes in Client Albums, which is private by design. The gallery is public the moment you publish."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 40. Work ────────────────────────────────────────────────────────────────
('work',
 'Work — the events page clients actually read',
 'One page per event you have delivered. The public gallery is built from these, and so is the "events delivered" figure on the homepage.',
 'fa-trophy', 'both', 40, TRUE,
 '[
   {"n":1,"title":"Add an event after you have delivered it","body":"Name it the way a client would say it — the venue and the occasion, not an internal reference."},
   {"n":2,"title":"File the photos against it","body":"They come from the Gallery tab. An event with no photos cannot be published, because there would be nothing on the page."},
   {"n":3,"title":"Star the best eight or ten","body":"Starred photos are the highlights the page leads with. The tab warns you when an event has photos filed but nothing starred, because that is the one state that blocks publishing."},
   {"n":4,"title":"Publish it","body":"Only published events appear on the public site. Drafts are yours to finish in your own time."},
   {"n":5,"title":"Leave the homepage counter alone unless it is wrong","body":"It is the events published here plus a starting figure from before this website existed. That starting figure is the only number on the site nothing else can check — correct it if it is wrong, and otherwise leave it."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 50. Client albums ───────────────────────────────────────────────────────
('albums',
 'Client albums — handing photos to the client',
 'A private album is one client, one link. It is how a client gets their photos without anything being made public.',
 'fa-folder-open', 'both', 50, TRUE,
 '[
   {"n":1,"title":"Create the album against the booking","body":"That is what ties the photos to a real job, and it is how the client''s name reaches the page they open."},
   {"n":2,"title":"Send the link to the client and nobody else","body":"Anyone holding the link can open the album. Treat it like the photos themselves: send it to the client, not to a group."},
   {"n":3,"title":"Let the client choose what may be shown publicly","body":"They tick the photos you may use. Their answer is recorded on the album — you never have to remember who said yes."},
   {"n":4,"title":"Only publish what they ticked","body":"A photo the client has not released stays in the album. This is the whole reason the consent step exists."},
   {"n":5,"title":"Point them at the review link when they are pleased","body":"The moment a client is looking at their own photos is the best moment you will get to ask for a review."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 60. Reviews ─────────────────────────────────────────────────────────────
('reviews',
 'Reviews — moderating what clients say',
 'Every review is read by a person before it appears anywhere. Nothing publishes itself.',
 'fa-star', 'both', 60, TRUE,
 '[
   {"n":1,"title":"Check the pending list often","body":"A review sitting unapproved is a happy client whose words are doing no work for you."},
   {"n":2,"title":"Approve the honest ones, including the merely good","body":"A wall of five stars reads as fake. A four-star review with a real sentence in it is worth more than another perfect one."},
   {"n":3,"title":"Reply before you reject","body":"A reply is public and shows how you handle a complaint. Reject only what is abusive, or plainly not from a client."},
   {"n":4,"title":"Feature two or three","body":"Featured reviews are what the homepage shows. Pick ones that name the kind of event you want more of."},
   {"n":5,"title":"Never write one yourself","body":"Reviews carry the client''s name and the booking they came from. An invented one is the fastest way to lose the value of every real one."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 70. Marketing ───────────────────────────────────────────────────────────
('marketing',
 'Marketing — offers, banners and posters',
 'One tab for everything promoted on the website, plus advice on when to discount that is worked out from your own enquiries and bookings.',
 'fa-bullhorn', 'both', 70, TRUE,
 '[
   {"n":1,"title":"Start with the overview","body":"It shows what is live right now, and what the numbers suggest you do next. Where the advice names specific empty weeks, the button beside it opens an offer already dated for those weeks."},
   {"n":2,"title":"Create an offer","body":"An offer is a code the client types when enquiring. Always set an end date and a maximum number of uses — an open-ended code can be shared and used forever."},
   {"n":3,"title":"Put it on the site with Advertise","body":"The Advertise button on an offer opens a banner already written for that code. A code nobody has been told about will not be used."},
   {"n":4,"title":"Set the banner priority","body":"Visitors see one banner at a time — the live one with the highest priority. The form warns you when another live banner already outranks the one you are writing, which is the only way a banner can look correct and never appear."},
   {"n":5,"title":"Use a poster when a line of text is not enough","body":"Posters are images that rotate on the homepage — a seasonal greeting, or an offer that needs a photo. They are separate from the banner bar and both can run at once."},
   {"n":6,"title":"Check whether it worked","body":"Each banner shows views, clicks and click rate; each offer shows exactly who used it. Pause rather than delete — deleting throws away the record of how the campaign performed."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 80. Services ────────────────────────────────────────────────────────────
('services',
 'Services — packages, features and questions',
 'What the business sells. Every service page on the website, and the list a client picks from when enquiring, is built from this tab.',
 'fa-headphones', 'both', 80, TRUE,
 '[
   {"n":1,"title":"Keep the description in the client''s words","body":"It is read by someone deciding whether to call you, not by someone who already knows what the equipment is."},
   {"n":2,"title":"Give each service two or three packages","body":"A single price invites haggling. Three tiers move the conversation to which one, and mark the middle one popular."},
   {"n":3,"title":"Answer the questions clients keep asking in the FAQs","body":"Every question answered on the page is a phone call you do not have to take, and it is answered the same way every time."},
   {"n":4,"title":"Pause a service instead of deleting it","body":"Deleting takes its page off the website along with the enquiries that reference it. Pausing hides it and keeps the history."},
   {"n":5,"title":"Watch which services go quiet","body":"The tab flags any service with no enquiries in 90 days. That is usually a visibility problem, not a price one — check the photos on its page before discounting it."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 90. Analytics ───────────────────────────────────────────────────────────
('analytics',
 'Analytics — reading the numbers honestly',
 'Every figure here is worked out in one place, so the same word means the same thing on every screen. What you see depends on your account: the manager''s view carries enquiries, conversion and reply times, and the owner''s adds the money.',
 'fa-chart-line', 'both', 90, TRUE,
 '[
   {"n":1,"title":"Pick the period first","body":"Every number on the screen answers to it. Comparing a 7-day figure with a 90-day one is the most common mistake made here."},
   {"n":2,"title":"Read the range, not just the rate","body":"A win rate is shown with the range it could really be. \"60%, could be 30–85%\" after five enquiries means you do not yet know your win rate — and the system says so rather than pretending."},
   {"n":3,"title":"Treat small samples as hints","body":"Ten enquiries is where a trend starts to mean something. Below that, a good week and a lucky week look identical."},
   {"n":4,"title":"Use reply time as the one you can act on today","body":"It is the only number in the tab entirely within your control, and it moves the win rate more reliably than discounting does."},
   {"n":5,"title":"Export before a meeting","body":"The CSV holds exactly what is on screen for the period selected, so nobody has to retype figures into a document."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 100. Money (owner only) ─────────────────────────────────────────────────
('money',
 'Money — agreed prices, payments and what is owed',
 'For the owner''s account only. The manager''s screens never show revenue, balances or margins.',
 'fa-coins', 'admin', 100, TRUE,
 '[
   {"n":1,"title":"An enquiry becomes money when you enter the agreed price","body":"Until that field is filled, a confirmed booking counts as work won and as zero revenue. Most gaps between the diary and the figures start here."},
   {"n":2,"title":"Record every payment against its booking","body":"Amount, method and M-Pesa code. Outstanding balance is agreed price minus what is recorded — nothing else feeds it."},
   {"n":3,"title":"Check outstanding before quoting a discount","body":"Money already earned and not yet collected is cheaper to chase than new work is to discount."},
   {"n":4,"title":"Keep staff costs in Payroll, not in notes","body":"A job''s margin is only as accurate as what has been recorded against it."},
   {"n":5,"title":"Nothing here is deleted quietly","body":"Payments and agreed prices carry who entered them and when, so a correction is visible as a correction."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 110. Team (owner only) ──────────────────────────────────────────────────
('team',
 'Team — staff records and payroll',
 'For the owner''s account only. These tabs are not on the manager''s screen, and the server refuses them to that account even if the address is typed in directly.',
 'fa-users', 'admin', 110, TRUE,
 '[
   {"n":1,"title":"Add each person once","body":"Payroll entries attach to the person, so a duplicate record splits one person''s history into two."},
   {"n":2,"title":"Record a payroll entry per event","body":"That is what makes the cost of a job answerable later, rather than a monthly total nobody can break down."},
   {"n":3,"title":"Rate the work while it is fresh","body":"Ratings roll up to the person, and are how you decide who to send to the next big job."},
   {"n":4,"title":"Mark paid only when the money has left","body":"Pending versus paid is what the outstanding figure reads."},
   {"n":5,"title":"Set someone inactive rather than deleting them","body":"Deleting removes their history along with them, including the events they worked."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 120. Work log (owner only) ──────────────────────────────────────────────
('worklog',
 'Work log — what the developer has delivered',
 'For the owner''s account only. Each entry is one piece of work on this system, its evidence, and its fee.',
 'fa-clipboard-list', 'admin', 120, TRUE,
 '[
   {"n":1,"title":"Read the entry and check the evidence","body":"Every item names what changed and where to see it working. Nothing needs to be taken on trust."},
   {"n":2,"title":"Accept or send it back with a reason","body":"Sending it back keeps the item open with your reason attached, which is a shorter conversation than a phone call later."},
   {"n":3,"title":"Accepted items are what an invoice is built from","body":"Nothing is invoiced that you have not accepted first."},
   {"n":4,"title":"Mark it paid when the money has gone","body":"That closes the item and is what the developer''s outstanding figure reads."},
   {"n":5,"title":"Export the log at the end of a project","body":"The CSV is the record of what was built and what it cost, in one file."}
 ]'::jsonb, CURRENT_DATE, 'system'),

-- ── 130. Getting help (both) ────────────────────────────────────────────────
('help',
 'Getting help — who to call, and what to send',
 'Two different problems, two different numbers. Something you are unsure how to do is an office question; something the system does wrong is a developer question.',
 'fa-life-ring', 'both', 130, TRUE,
 '[
   {"n":1,"title":"Office — +254 703 925 826","body":"For anything about the business itself: a client, a booking, a price, what to do about an event. Second line: +254 733 925 826."},
   {"n":2,"title":"Developer — +254 711 939 907","body":"Kelvin Ndegwa, who built this system. Call or WhatsApp for anything on these screens that is broken, wrong or missing: a button that does nothing, a figure that cannot be right, a page that will not load. Email ndegwak6@gmail.com for anything that needs a document attached."},
   {"n":3,"title":"Send a screenshot, the time, and what you expected","body":"Those three things resolve most reports without a call back. \"It is not working\" cannot be acted on; \"I pressed Save at 4pm and got a red message\" can."},
   {"n":4,"title":"Nothing you do here can break the website","body":"Anything published can be paused or unpublished, and nothing is deleted without asking twice. Say so, ask, and carry on."},
   {"n":5,"title":"If a guide here is out of date, that is a bug too","body":"These sections are dated at the bottom, and go yellow after four months without a check. Tell the developer which one no longer matches the screen."}
 ]'::jsonb, CURRENT_DATE, 'system')

ON CONFLICT (slug) DO UPDATE SET
  title            = EXCLUDED.title,
  intro            = EXCLUDED.intro,
  icon             = EXCLUDED.icon,
  audience         = EXCLUDED.audience,
  display_order    = EXCLUDED.display_order,
  is_published     = EXCLUDED.is_published,
  steps            = EXCLUDED.steps,
  last_reviewed_on = EXCLUDED.last_reviewed_on,
  updated_by       = EXCLUDED.updated_by,
  updated_at       = NOW();

COMMIT;

-- ── Check ───────────────────────────────────────────────────────────────────
-- SELECT slug, audience, display_order, jsonb_array_length(steps) AS steps
--   FROM training_guides ORDER BY display_order;
--
-- Manager sees: WHERE is_published AND audience IN ('manager','both')
-- Owner sees:   everything.
