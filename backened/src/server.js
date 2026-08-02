const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'lawie-sounds-dev-secret-CHANGE-IN-PRODUCTION';

const app = express();

// Security headers
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

// HTTP request logging
app.use(morgan('combined'));

// CORS — allow production domain + localhost dev
const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL, // e.g. https://lawie-sounds-website.vercel.app
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'https://127.0.0.1:5500',
].filter(Boolean);

// Rejecting by passing an Error to the callback makes the request fall through
// to the generic error handler, which answers 500 "Internal server error". That
// is actively misleading: a disallowed origin is a configuration problem, not a
// server fault, and the opaque 500 gives whoever deployed to a new domain
// without setting FRONTEND_URL nothing to go on. Refuse the CORS headers and
// let the route run — the browser still blocks the response, and a same-origin
// or server-to-server caller is unaffected.
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                     // same-origin / server-to-server
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    console.warn(`[CORS] refused origin ${origin}. Add it to FRONTEND_URL if this is expected.`);
    cb(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options(/.*/, cors()); // handle preflight for all routes (Express 5 regex syntax)

app.use(express.json({ limit: '20mb' })); // support base64 image uploads

// Rate limiting — 100 req/15min general, 10 req/15min on login
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many login attempts. Try again in 15 minutes.' }, standardHeaders: true, legacyHeaders: false });
// Public enquiry submission — the form is now the only delivery channel, so it
// needs its own spam ceiling that is generous for humans (a client may resubmit
// after a correction) but stops scripted floods.
const bookingLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 8, message: { error: 'Too many booking requests from this device. Please call us on +254 703 925 826.' }, standardHeaders: true, legacyHeaders: false });
app.use('/api/', generalLimiter);
app.use('/api/admin/auth/login', loginLimiter);

// Supabase client (service role — bypasses RLS, admin-level access)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ==================== AUTH MIDDLEWARE ====================
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Session expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Admin-only guard — blocks the manager role from financial/staff data.
// The dashboard hides these tabs for managers, but that's cosmetic only;
// this enforces it server-side so a manager token can't reach the data via the API.
function adminOnly(req, res, next) {
  if (req.admin?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden — administrator access required' });
  }
  next();
}

// ==================== MAPPING (DB snake_case → API camelCase) ====================
const map = {
  event: (r) => r && ({ id: r.id, title: r.title, date: r.date, venue: r.venue, price: r.price, totalSeats: r.total_seats, seatsLeft: r.seats_left, description: r.description, image: r.image, status: r.status, isActive: r.is_active, bookingCount: r.booking_count, createdAt: r.created_at }),
  service: (r) => r && ({ id: r.id, name: r.name, slug: r.slug, category: r.category, icon: r.icon, shortDesc: r.short_desc, longDesc: r.long_desc, mainImage: r.image, isActive: r.is_active, displayOrder: r.display_order, priceDisplay: r.price_display || 'from', budgetNote: r.budget_note, packages: r.packages || [], features: r.features || [], faqs: r.faqs || [], createdAt: r.created_at }),
  gallery: (r) => r && ({ id: r.id, title: r.title, category: r.category, type: r.type, imageUrl: r.image_url, serviceSlug: r.service_slug, isFeatured: r.is_featured, displayOrder: r.display_order, altText: r.alt_text, caption: r.caption, width: r.width, height: r.height, isPublished: r.is_published, storagePath: r.storage_path, mimeType: r.mime_type, fileSize: r.file_size, thumbUrl: r.thumb_url, eventDate: r.event_date, createdAt: r.created_at }),
  galleryCategory: (r) => r && ({ slug: r.slug, label: r.label, emoji: r.emoji, displayOrder: r.display_order }),
  payment: (r) => r && ({ id: r.id, bookingId: r.booking_id, amount: Number(r.amount), paidOn: r.paid_on, method: r.method, reference: r.reference, note: r.note, recordedBy: r.recorded_by, createdAt: r.created_at }),
  // ADMIN view. Includes the real name so the manager can recognise a client.
  // withdrawal_token is deliberately absent — it is a bearer secret belonging to
  // the reviewer, and nothing in the dashboard needs it.
  review: (r) => r && ({ id: r.id, clientName: r.client_name, displayName: r.display_name, showFullName: r.show_full_name, rating: r.rating, comment: r.comment, eventType: r.event_type, eventDate: r.event_date, serviceId: r.service_id, clientImage: r.client_image, status: r.status, isApproved: r.is_approved, isFeatured: r.is_featured, isVerified: r.is_verified, bookingId: r.booking_id, adminReply: r.admin_reply, consentPublish: r.consent_publish, consentVersion: r.consent_version, consentedAt: r.consented_at, moderatedAt: r.moderated_at, moderatedBy: r.moderated_by, rejectionReason: r.rejection_reason, withdrawnAt: r.withdrawn_at, createdAt: r.created_at }),

  // PUBLIC view. A deliberately narrow allow-list rather than a deny-list: a
  // column added later is invisible to the public API until someone chooses to
  // expose it, instead of leaking by default. Note what is NOT here —
  // client_name, booking_id, submitter_hash, user_agent, withdrawal_token.
  publicReview: (r) => r && ({ id: r.id, name: r.display_name, rating: r.rating, comment: r.comment, eventType: r.event_type, eventDate: r.event_date, serviceId: r.service_id, isFeatured: r.is_featured, isVerified: r.is_verified, adminReply: r.admin_reply, createdAt: r.created_at }),
  // ADMIN view — includes the performance counters.
  banner: (r) => r && ({ id: r.id, type: r.type, name: r.name, message: r.message, ctaText: r.cta_text, ctaLink: r.cta_link, isActive: r.is_active, startDate: r.start_date, endDate: r.end_date, priority: r.priority, style: r.style, offerId: r.offer_id, views: r.views ?? 0, clicks: r.clicks ?? 0, ctr: r.ctr === null || r.ctr === undefined ? 0 : Number(r.ctr), createdAt: r.created_at }),

  // PUBLIC view. views/clicks/ctr are our own performance data and were being
  // shipped to every visitor through /api/banners. Allow-list, so a column
  // added later is not exposed by default.
  publicBanner: (r) => r && ({ id: r.id, type: r.type, message: r.message, ctaText: r.cta_text, ctaLink: r.cta_link, style: r.style, priority: r.priority }),

  // Packages are real rows now, not JSONB array entries addressed by index.
  // `id` is the point: editing and deleting no longer depend on array position,
  // which is what made concurrent edits hit the wrong package.
  workItem: (r) => r && ({ id: r.id, reference: r.reference, title: r.title, summary: r.summary, category: r.category, deliveredOn: r.delivered_on, fee: r.fee === null || r.fee === undefined ? null : Number(r.fee), hours: r.hours === null || r.hours === undefined ? null : Number(r.hours), evidence: r.evidence, status: r.status, createdBy: r.created_by, acceptedBy: r.accepted_by, acceptedAt: r.accepted_at, rejectedReason: r.rejected_reason, invoiceRef: r.invoice_ref, invoicedAt: r.invoiced_at, paidAt: r.paid_at, notes: r.notes, locked: r.locked, createdAt: r.created_at }),

  trainingGuide: (r) => r && ({ id: r.id, slug: r.slug, title: r.title, intro: r.intro, icon: r.icon, audience: r.audience, steps: r.steps || [], displayOrder: r.display_order, isPublished: r.is_published, lastReviewedOn: r.last_reviewed_on, updatedBy: r.updated_by }),

  servicePackage: (r) => r && ({ id: r.id, serviceId: r.service_id, name: r.name, price: r.price === null || r.price === undefined ? null : Number(r.price), duration: r.duration, features: r.features || [], displayOrder: r.display_order, isActive: r.is_active, isPopular: r.is_popular, createdAt: r.created_at }),

  offer: (r) => r && ({ id: r.id, code: r.code, label: r.label, description: r.description, discountType: r.discount_type, discountValue: Number(r.discount_value), minAmount: r.min_amount === null ? null : Number(r.min_amount), appliesTo: r.applies_to || [], startsOn: r.starts_on, endsOn: r.ends_on, maxRedemptions: r.max_redemptions, timesRedeemed: r.times_redeemed, isActive: r.is_active, notes: r.notes, createdBy: r.created_by, createdAt: r.created_at }),
  booking: (r) => r && ({ id: r.id, bookingReference: r.booking_reference, name: r.name, email: r.email, phone: r.phone, eventDate: r.event_date, eventType: r.event_type, eventId: r.event_id, guestCount: r.guest_count, budget: r.budget, venue: r.venue, services: r.services, selectedPackage: r.selected_package, ticketQuantity: r.ticket_quantity, totalAmount: r.total_amount, status: r.status, notes: r.notes, specialRequests: r.event_details, source: r.source, channel: r.channel, respondedAt: r.responded_at, handledBy: r.handled_by, agreedAmount: r.agreed_amount === null || r.agreed_amount === undefined ? null : Number(r.agreed_amount), agreedAt: r.agreed_at, agreedBy: r.agreed_by, createdAt: r.created_at }),
  employee: (r) => r && ({ id: r.id, name: r.name, role: r.role, phone: r.phone, email: r.email, hireDate: r.hire_date, status: r.status, totalEvents: r.total_events, avgRating: r.avg_rating, createdAt: r.created_at }),
  payroll: (r) => r && ({ id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, eventName: r.event_name, eventDate: r.event_date, amount: r.amount, status: r.status, paymentDate: r.payment_date, rating: r.rating, createdAt: r.created_at }),
  poster: (r) => r && ({ id: r.id, title: r.title, imageUrl: r.image_url, caption: r.caption, isActive: r.is_active, startDate: r.start_date, endDate: r.end_date, displayOrder: r.display_order, mediaType: r.media_type || 'image', storagePath: r.storage_path, thumbUrl: r.thumb_url, thumbPath: r.thumb_path, mimeType: r.mime_type, fileSize: r.file_size, width: r.width, height: r.height, createdAt: r.created_at }),
  // The homepage needs enough to render the poster and nothing else. storage_path
  // is internal plumbing — it names an object in our bucket, and publishing it
  // invites people to probe paths we never intended to expose.
  publicPoster: (r) => r && ({ id: r.id, title: r.title, imageUrl: r.image_url, caption: r.caption, mediaType: r.media_type || 'image', thumbUrl: r.thumb_url, width: r.width, height: r.height }),
  notification: (r) => r && ({ id: r.id, type: r.type, title: r.title, message: r.message, isRead: r.is_read, referenceId: r.reference_id, referenceTable: r.reference_table, createdAt: r.created_at }),
  setting: (r) => r && ({ id: r.id, key: r.key, value: r.value, description: r.description, updatedAt: r.updated_at }),
};

// ==================== DB CONVERTERS (API camelCase → DB snake_case) ====================
// `isUpdate` keeps accumulated counters out of UPDATE payloads. The dashboard
// edit form does not round-trip booking_count, so including it on update reset
// every event's booking count to 0 on each save.
function toEventDB(b, isUpdate = false) {
  const row = { title: b.title, date: b.date, venue: b.venue, price: b.price || 0, total_seats: b.totalSeats, seats_left: b.seatsLeft !== undefined ? b.seatsLeft : b.totalSeats, description: b.description, image: b.image, status: b.status || 'published', is_active: b.isActive !== false };
  if (!isUpdate) row.booking_count = b.bookingCount || 0;
  return row;
}
function toServiceDB(b) {
  const row = {
    name: b.name,
    slug: b.slug || String(b.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    category: b.category, icon: b.icon,
    short_desc: b.shortDesc, long_desc: b.longDesc,
    image: b.mainImage || b.image,
    is_active: b.isActive !== false,
    display_order: b.displayOrder || 0,
    features: b.features || [], faqs: b.faqs || [],
  };

  // Packages live in service_packages now. Writing the JSONB column here would
  // resurrect the old copy every time a service was saved and give two
  // conflicting sources of truth for the same prices.
  if (b.priceDisplay !== undefined) {
    row.price_display = ['from', 'range', 'on_request'].includes(b.priceDisplay) ? b.priceDisplay : 'from';
  }
  if (b.budgetNote !== undefined) row.budget_note = b.budgetNote?.trim() || null;

  return row;
}
// Gallery rows are written from two places (create-after-upload, and the edit
// form), so the shape lives in one function. `isUpdate` omits keys the edit
// form does not round-trip, so saving a caption cannot blank the storage
// bookkeeping — the same class of bug that used to zero events.booking_count.
function toGalleryDB(b, isUpdate = false) {
  const row = {
    title:         String(b.title || '').trim(),
    category:      b.category || 'General',
    type:          b.type === 'video' ? 'video' : 'image',
    service_slug:  b.serviceSlug || null,
    is_featured:   b.isFeatured === true,
    display_order: Number.isFinite(+b.displayOrder) ? +b.displayOrder : 0,
    // alt_text falls back to the title: an imperfect description still beats an
    // empty alt attribute for anyone using a screen reader.
    alt_text:      (b.altText || b.title || '').trim() || null,
    caption:       b.caption?.trim() || null,
    event_date:    b.eventDate || null,
    thumb_url:     b.thumbUrl || null,
  };
  if (b.isPublished !== undefined) row.is_published = b.isPublished !== false;

  // Storage bookkeeping only moves when a file is actually attached — either on
  // create, or on an edit that replaces the image.
  if (b.imageUrl)    row.image_url    = b.imageUrl;
  if (b.storagePath) row.storage_path = b.storagePath;
  if (b.mimeType)    row.mime_type    = b.mimeType;
  if (Number.isFinite(+b.fileSize)) row.file_size = +b.fileSize;
  if (Number.isFinite(+b.width))    row.width     = +b.width;
  if (Number.isFinite(+b.height))   row.height    = +b.height;

  if (!isUpdate && !row.is_published) row.is_published = false;
  return row;
}
// Same pattern as toEventDB: views/clicks/ctr are accumulated by the site, not
// supplied by the edit form. Sending them on UPDATE wiped a banner's entire
// performance history every time someone fixed a typo.
function toBannerDB(b, isUpdate = false) {
  const row = { type: b.type || 'banner', name: b.name, message: b.message, cta_text: b.ctaText, cta_link: b.ctaLink, is_active: b.isActive !== false, start_date: b.startDate || null, end_date: b.endDate || null, priority: b.priority || 0 };
  // views/clicks are seeded to 0 on create only, so an edit cannot wipe a
  // banner's accumulated performance history.
  //
  // ctr is NOT set here any more: as of the 2026-07-31 migration it is a
  // GENERATED ALWAYS column derived from views and clicks, and Postgres rejects
  // any attempt to write one ("cannot insert a non-DEFAULT value into column").
  // Leaving it in this payload broke every banner create.
  if (!isUpdate) { row.views = 0; row.clicks = 0; }
  return row;
}
function toEmployeeDB(b) {
  return { name: b.name, role: b.role, phone: b.phone, email: b.email, hire_date: b.hireDate, status: b.status || 'active', total_events: b.totalEvents || 0, avg_rating: b.avgRating || 0 };
}
function toPayrollDB(b) {
  return { employee_id: b.employeeId, employee_name: b.employeeName, event_name: b.eventName, event_date: b.eventDate, amount: b.amount, status: b.status || 'pending', payment_date: b.status === 'paid' ? (b.paymentDate || new Date().toISOString().split('T')[0]) : null, rating: b.rating || 0 };
}

// Update employee stats after payroll changes
async function syncEmployeeStats(employeeId) {
  if (!employeeId) return;
  const { data } = await supabase.from('payroll').select('rating').eq('employee_id', employeeId).gt('rating', 0);
  if (!data) return;
  const avg = data.length ? data.reduce((s, p) => s + p.rating, 0) / data.length : 0;
  await supabase.from('employees').update({ total_events: data.length, avg_rating: parseFloat(avg.toFixed(1)) }).eq('id', employeeId);
}

function handleError(res, error, status = 500) {
  console.error(error);
  return res.status(status).json({ error: error.message || 'An error occurred' });
}

// Postgres `services` is text[]. Accept an array, a comma-joined string, or
// null, and always hand Postgres a real array — a bare string is rejected as a
// malformed array literal.
function toTextArray(value) {
  if (value == null || value === '') return null;
  const arr = Array.isArray(value) ? value : String(value).split(',');
  const cleaned = arr.map(v => String(v).trim()).filter(Boolean);
  return cleaned.length ? cleaned : null;
}

// Metadata columns that are nice to have but must never cost us a write.
// If the database has not been migrated yet, dropping these is far better than
// failing — an enquiry is revenue, a missing `source` is not.
//
// `notes` is deliberately NOT in this list. It carries text a human typed, so
// dropping it would report success while discarding their work. That must fail
// loudly instead — see the notes route below.
const DROPPABLE_BOOKING_COLUMNS = ['channel', 'event_details', 'source', 'responded_at', 'handled_by'];

// Run a bookings write, retrying without any droppable column the live schema
// is missing. This is the exact failure that silently swallowed every booking
// before 2026-07-27: server.js wrote a column that did not exist, PostgREST
// returned PGRST204, and the enquiry was lost. Now we degrade and log loudly.
async function resilientBookingWrite(run, payload) {
  let body = { ...payload };

  for (let attempt = 0; attempt <= DROPPABLE_BOOKING_COLUMNS.length; attempt++) {
    const { data, error } = await run(body);
    if (!error) return { data, error: null };

    // PGRST204 = column not found in PostgREST's schema cache.
    const missing = error.code === 'PGRST204' &&
      DROPPABLE_BOOKING_COLUMNS.find(c => (error.message || '').includes(`'${c}'`));

    if (!missing || !(missing in body)) return { data: null, error };

    console.error(
      `[SCHEMA DRIFT] bookings.${missing} is missing from the database. ` +
      `Retrying without it. Run database/migrations/2026-07-27_final_audit_cleanup.sql to fix.`
    );
    delete body[missing];
  }

  return { data: null, error: new Error('Booking write failed after dropping optional columns') };
}

const insertBooking = (row) =>
  resilientBookingWrite(b => supabase.from('bookings').insert(b).select().single(), row);

const updateBooking = (id, patch) =>
  resilientBookingWrite(b => supabase.from('bookings').update(b).eq('id', id).select().single(), patch);

// ==================== MARKETING ====================

// Anything that lands in an href. cta_link was assigned straight to
// element.href on the homepage with no validation, so a javascript: URL would
// have executed on click. Enforced here AND by a CHECK constraint, because the
// database is the one place every write path has to pass through.
const UNSAFE_URL_SCHEME = /^\s*(javascript|data|vbscript|file):/i;

function isSafeCtaLink(url) {
  if (!url) return true;                                  // empty falls back to /booking.html
  if (UNSAFE_URL_SCHEME.test(url)) return false;
  // Allow site-relative paths, anchors, and explicit http(s)/tel/mailto.
  return /^(\/|#|https?:\/\/|tel:|mailto:)/i.test(url.trim());
}

// Impression and click reporting is public and unauthenticated, so it is the
// easiest thing on the site to inflate. A per-IP ceiling keeps a bored visitor
// (or a broken retry loop) from turning CTR into fiction. It cannot stop a
// determined attacker — but the number is for the marketer's own decisions, not
// for billing, so cheap mitigation is the right trade.
const bannerMetricLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  message: { error: 'Too many requests.' },
  standardHeaders: true, legacyHeaders: false,
});

// Code entry is a guessing surface: without a limit, someone could brute-force
// short codes to find an unpublished discount.
const offerCheckLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 20,
  message: { error: 'Too many code attempts. Please try again shortly.' },
  standardHeaders: true, legacyHeaders: false,
});

function normaliseCode(code) {
  return String(code || '').trim().toUpperCase().slice(0, 40);
}

// Resolve a code to a usable offer, or to a reason it cannot be used.
//
// Every rejection says which rule failed, because "invalid code" for an expired
// promotion sends the client to the phone convinced the site is broken.
async function resolveOffer(rawCode, { amount, services } = {}) {
  const code = normaliseCode(rawCode);
  if (!code) return { ok: false, reason: 'Enter a promo code.' };

  const today = new Date().toISOString().split('T')[0];

  // Matched case-insensitively, same as the unique index, so "aug10" finds
  // "AUG10". ilike with no wildcards is an equality match.
  const { data: offer } = await supabase.from('offers')
    .select('*').ilike('code', code).maybeSingle();

  if (!offer)            return { ok: false, reason: 'That code is not recognised.' };
  if (!offer.is_active)  return { ok: false, reason: 'That offer is no longer running.' };
  if (offer.starts_on > today) {
    return { ok: false, reason: `That offer starts on ${offer.starts_on}.` };
  }
  if (offer.ends_on && offer.ends_on < today) {
    return { ok: false, reason: 'That offer has expired.' };
  }
  if (offer.max_redemptions !== null && offer.times_redeemed >= offer.max_redemptions) {
    return { ok: false, reason: 'That offer has been fully claimed.' };
  }
  if (offer.min_amount !== null && amount !== undefined && amount !== null && Number(amount) < Number(offer.min_amount)) {
    return { ok: false, reason: `That code applies to bookings from KES ${Number(offer.min_amount).toLocaleString('en-KE')}.` };
  }
  if (Array.isArray(offer.applies_to) && offer.applies_to.length && Array.isArray(services) && services.length) {
    const overlap = offer.applies_to.some(s => services.includes(s));
    if (!overlap) return { ok: false, reason: 'That code does not apply to the services selected.' };
  }
  return { ok: true, offer };
}

// What the discount is worth. Returned to the client so the form can show it,
// and snapshotted onto the redemption row so later edits to the offer cannot
// rewrite history.
function describeDiscount(offer, amount) {
  const value = Number(offer.discount_value);
  if (offer.discount_type === 'percent') {
    return {
      label: `${value}% off`,
      amountOff: amount ? Math.round((Number(amount) * value) / 100) : null,
    };
  }
  return { label: `KES ${value.toLocaleString('en-KE')} off`, amountOff: value };
}

// ==================== REVIEWS ====================
const crypto = require('crypto');

// The exact wording a reviewer agrees to, versioned. Stored per review so we
// can always answer "what was this person actually told?" — a consent record
// that does not capture the terms consented to is not much of a record.
// Bump the version whenever the wording changes; never edit a version in place.
const CONSENT_VERSION = '2026-07-29.v1';
const CONSENT_NOTICE = [
  'Your review, your star rating and your chosen display name will be shown publicly on the Lawie Sounds website.',
  'By default we show your first name and last initial (for example, "Sarah K."). You can choose to show your full name instead.',
  'We do not publish your phone number, email address or booking reference. They are never shown to anyone but Lawie Sounds staff.',
  'Your review is checked by a person before it appears. We may reply to it publicly.',
  'You can withdraw your review at any time using the private link we give you after you submit. Withdrawing removes it from the website immediately.',
].join(' ');

const REVIEW_PAGE_SIZE = 12;
const REVIEW_MAX_PAGE  = 50;
const REVIEW_MIN_COMMENT = 10;
const REVIEW_MAX_COMMENT = 1500;

// One device, three reviews an hour. Generous for a couple submitting separately
// from the same wifi; useless for a script.
//
// skipFailedRequests matters more than it looks: without it, a rejected
// validation attempt burns one of the three, so a client who mistypes their
// rating twice and forgets the consent box once is locked out for an hour
// having never successfully said anything. Only submissions that actually
// created a review should count. Bots hammering invalid payloads are still
// cheap to reject and still capped by the global 300/15min limiter.
const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: parseInt(process.env.REVIEW_RATE_LIMIT, 10) || 3,
  skipFailedRequests: true,
  message: { error: 'You have submitted several reviews recently. Please try again later, or call us on +254 703 925 826.' },
  standardHeaders: true, legacyHeaders: false,
});

// Abuse signal without an identifier. We keep a salted hash of the IP so we can
// see "this submitter again" — we cannot turn it back into an address, and it is
// useless to anyone who obtains the database without the salt.
function hashSubmitter(ip) {
  if (!ip) return null;
  const salt = process.env.REVIEW_HASH_SALT || process.env.JWT_SECRET || 'lawie-fallback-salt';
  return crypto.createHmac('sha256', salt).update(String(ip)).digest('hex').slice(0, 32);
}

// Data minimisation applied at the point of storage, not at the point of
// display: the reduced form is what gets written to display_name, so the public
// API cannot accidentally leak the full name later.
function toDisplayName(fullName, showFull) {
  const name  = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!name) return 'A client';
  if (showFull) return name.slice(0, 80);

  const parts = name.split(' ');
  if (parts.length === 1) return parts[0].slice(0, 40);
  const initial = parts[parts.length - 1][0];
  return `${parts[0].slice(0, 40)} ${initial.toUpperCase()}.`;
}

function newWithdrawalToken() {
  return crypto.randomBytes(24).toString('base64url');
}

// A review referencing a real booking earns a "Verified client" badge. The
// reference is matched then discarded from the response — we store the booking
// id, never echo it back, and never publish it.
async function matchBooking(reference) {
  if (!reference) return null;
  const ref = String(reference).trim().toUpperCase();
  if (!/^LS-\d{4}-[A-Z0-9]{6}$/.test(ref)) return null;
  const { data } = await supabase.from('bookings')
    .select('id').eq('booking_reference', ref).maybeSingle();
  return data?.id || null;
}

function reviewPageParams(query) {
  const limit  = Math.min(Math.max(parseInt(query.limit, 10) || REVIEW_PAGE_SIZE, 1), REVIEW_MAX_PAGE);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

// ==================== GALLERY ====================
const GALLERY_BUCKET = 'gallery';

// Mirrors the bucket's allowed_mime_types. Checked here too so a bad upload is
// rejected before we mint a token, with a message the manager can act on,
// rather than failing opaquely at the Storage API.
const GALLERY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif':  'gif', 'image/avif': 'avif',
  'video/mp4':  'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
const GALLERY_MAX_BYTES = 50 * 1024 * 1024;   // matches bucket file_size_limit
const GALLERY_PAGE_SIZE = 24;
const GALLERY_MAX_PAGE  = 100;

// Clamp pagination. An uncapped ?limit is a free denial-of-service: the old
// endpoint had no limit at all and shipped every row to every visitor.
function pageParams(query, fallback = GALLERY_PAGE_SIZE) {
  const limit  = Math.min(Math.max(parseInt(query.limit, 10) || fallback, 1), GALLERY_MAX_PAGE);
  const offset = Math.max(parseInt(query.offset, 10) || 0, 0);
  return { limit, offset };
}

// Storage keys must be ASCII-safe. Titles are free text from a human, and the
// live data already contains spaces and ampersands ("Power & Lighting"), which
// would otherwise produce keys that need escaping at every use site.
function storageKey(title, mime, prefix = '') {
  const ext  = GALLERY_MIME[mime] || 'bin';
  const stem = String(title || 'item').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${new Date().getFullYear()}/${stem}-${Date.now().toString(36)}${rand}.${ext}`;
}

// Posters share the gallery bucket under their own prefix rather than getting a
// bucket of their own. The bucket already has the right MIME allow-list, the
// right 50 MB ceiling and a proven public-read policy; a second bucket would
// duplicate all three and add a new policy surface for no functional gain.
// Listings are driven by the posters table, never by enumerating the bucket, so
// the two sets never mix.
const POSTER_PREFIX = 'posters/';

// Validate a gallery write. Returns a field->message map the dashboard renders
// inline, so the manager sees which input is wrong instead of "Save Failed".
async function validateGallery(body, { requireImage }) {
  const errors = {};
  const title = String(body.title || '').trim();

  if (title.length < 2)   errors.title = 'Give this photo a title (at least 2 characters).';
  if (title.length > 160) errors.title = 'Title is too long (max 160 characters).';

  if (requireImage && !body.imageUrl) errors.imageUrl = 'Upload a file before saving.';

  if (body.type && !['image', 'video'].includes(body.type)) {
    errors.type = 'Type must be image or video.';
  }
  // A video with no poster makes the grid download video bytes just to paint a
  // thumbnail — the single biggest cost on a gallery page.
  if (body.type === 'video' && requireImage && !body.thumbUrl) {
    errors.thumbUrl = 'A video needs a poster image so the gallery grid stays fast.';
  }
  if (body.eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.eventDate)) {
    errors.eventDate = 'Invalid date.';
  }
  if (body.caption && String(body.caption).length > 500) {
    errors.caption = 'Caption is limited to 500 characters.';
  }

  // Category is a foreign key now. Catch it here so the manager gets a readable
  // message instead of a raw Postgres FK violation.
  if (body.category) {
    const { data: cat } = await supabase
      .from('gallery_categories').select('slug').eq('slug', body.category).maybeSingle();
    if (!cat) errors.category = `Unknown category "${body.category}".`;
  }
  if (body.serviceSlug) {
    const { data: svc } = await supabase
      .from('services').select('slug').eq('slug', body.serviceSlug).maybeSingle();
    if (!svc) errors.serviceSlug = `Unknown service "${body.serviceSlug}".`;
  }
  return errors;
}

// Remove a Storage object, tolerating failure. Legacy rows point at repo-static
// files under /IMAGES/ and have no storage_path — those must never be touched.
async function removeGalleryObject(storagePath) {
  if (!storagePath) return;
  const { error } = await supabase.storage.from(GALLERY_BUCKET).remove([storagePath]);
  if (error) console.error(`[GALLERY] orphaned object ${storagePath}: ${error.message}`);
}

// WhatsApp push notification via CallMeBot (free — admin must activate once)
// Setup: WhatsApp +34 644 38 11 72, send: "I allow callmebot to send me messages"
// Then add ADMIN_PHONE and CALLMEBOT_APIKEY to Vercel env vars
async function notifyAdmin(message) {
  const phone = process.env.ADMIN_PHONE;
  const apiKey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apiKey) return;
  try {
    // Must be awaited: Vercel freezes the serverless function once the response
    // is sent, so an un-awaited fetch here was routinely cancelled mid-flight.
    // Timeout so a slow third party can never hold up the client's confirmation.
    await fetch(
      `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`,
      { signal: AbortSignal.timeout(4000) }
    );
  } catch (e) {
    console.error('notifyAdmin failed (non-fatal):', e.message);
  }
}

// Create an in-app notification record (fire-and-forget)
async function createNotification(type, title, message, referenceId, referenceTable) {
  try {
    await supabase.from('notifications').insert({ type, title, message, reference_id: referenceId || null, reference_table: referenceTable || null });
  } catch (e) {}
}

// ==================== PUBLIC ROUTES ====================

app.get('/health',     (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/api/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
// Tells the login page whether env vars are configured (never reveals values)
app.get('/api/admin/auth/config', (_, res) => res.json({
  adminConfigured:   !!(process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD),
  managerConfigured: !!(process.env.MANAGER_USERNAME && process.env.MANAGER_PASSWORD),
}));

// Services (active only — full data so service-detail pages render correctly)
app.get('/api/services', async (req, res) => {
  const { data, error } = await supabase.from('services').select('*').eq('is_active', true).order('display_order');
  if (error) return handleError(res, error);

  // One query for every service's packages rather than one per service — the
  // services list page needs the cheapest package to show "Starting from KES X",
  // and that price is the single most important thing missing from the site.
  const { data: pkgs } = await supabase.from('service_packages')
    .select('*').eq('is_active', true).order('display_order');

  const byService = (pkgs || []).reduce((acc, p) => {
    (acc[p.service_id] ||= []).push(p);
    return acc;
  }, {});

  res.json({
    success: true,
    // applyPriceDisplay decides what actually leaves the server. Under
    // 'on_request' the numbers are stripped from the payload rather than hidden
    // by the page.
    data: data.map(s => ({ ...map.service(s), ...applyPriceDisplay(s, byService[s.id] || []) })),
  });
});

// Single service by slug or UUID (for service-detail.html)
app.get('/api/services/:slug', async (req, res) => {
  const { slug } = req.params;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
  const { data, error } = await supabase.from('services').select('*')
    .eq(isUuid ? 'id' : 'slug', slug).eq('is_active', true).single();
  if (error || !data) return res.status(404).json({ error: 'Service not found' });
  // Also fetch approved reviews for this service
  // display_name, not client_name: the service page is public, so it gets the
  // minimised identity like every other public surface.
  const { data: reviews } = await supabase.from('reviews')
    .select('id,display_name,rating,comment,event_type,event_date,is_verified,is_featured,admin_reply,created_at')
    .eq('status', 'published').eq('service_id', data.id)
    .order('is_featured', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false }).limit(6);
  // Fetch gallery images linked to this service (by service_slug field if set, else by slug match)
  // service_slug was NULL on every gallery row until the 2026-07-28 migration
  // backfilled it, so this block silently returned nothing on every request.
  const { data: gallery } = await supabase
    .from('gallery')
    .select('id,title,category,type,image_url,alt_text,width,height,thumb_url')
    .eq('service_slug', data.slug)
    .eq('is_published', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(12);
  // Packages come from service_packages now. Served under the same `packages`
  // key and the same shape the pages already read, so the public frontend needs
  // no change and the JSONB column can be retired without a flag day.
  const { data: pkgs } = await supabase.from('service_packages')
    .select('*').eq('service_id', data.id).eq('is_active', true)
    .order('display_order').order('price', { ascending: true, nullsFirst: false });

  res.json({
    success: true,
    data: {
      ...map.service(data),
      ...applyPriceDisplay(data, pkgs || []),
      reviews: (reviews || []).map(map.publicReview),
      gallery: (gallery || []).map(map.gallery),
    },
  });
});

// Events (upcoming active)
app.get('/api/events', async (req, res) => {
  const { data, error } = await supabase.from('events').select('*').eq('is_active', true).order('date');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.event) });
});

// Category taxonomy with live counts. Single source of truth: the public page
// and the dashboard both read this, so their category lists can no longer drift
// apart the way they had (live data used Audio/Media/Visual, the dashboard
// offered Weddings/Ruracio/Parties — only one value overlapped).
app.get('/api/gallery/categories', async (req, res) => {
  const { data: cats, error } = await supabase
    .from('gallery_categories').select('*').eq('is_active', true).order('display_order');
  if (error) return handleError(res, error);

  const { data: rows } = await supabase
    .from('gallery').select('category').eq('is_published', true);

  const counts = (rows || []).reduce((acc, r) => (acc[r.category] = (acc[r.category] || 0) + 1, acc), {});
  res.json({
    success: true,
    // Empty categories are noise on a filter bar — a pill that always yields
    // "nothing here" is a dead end the visitor has to discover by tapping it.
    data: cats.filter(c => counts[c.slug]).map(c => ({ ...map.galleryCategory(c), count: counts[c.slug] })),
    meta: { total: Object.values(counts).reduce((a, b) => a + b, 0) },
  });
});

// Gallery — ?featured=true, ?category=X, ?service=slug, ?limit=&offset=
//
// Paginated. The previous version was select('*') with no limit, so every
// visitor downloaded every row — including a 372 KB base64 blob stored in the
// image_url column. Media now lives in Supabase Storage and rows are small,
// but the cap stays: an uncapped list endpoint is a standing liability.
app.get('/api/gallery', async (req, res) => {
  const { limit, offset } = pageParams(req.query);

  let q = supabase.from('gallery')
    .select('*', { count: 'exact' })
    .eq('is_published', true);          // drafts must never reach the public page

  if (req.query.featured === 'true')   q = q.eq('is_featured', true);
  if (req.query.category)              q = q.eq('category', req.query.category);
  if (req.query.service)               q = q.eq('service_slug', req.query.service);

  // Search must run server-side: filtering only the rows the browser happens to
  // have paged in would silently miss matches further down the list.
  //
  // Inside an or() group PostgREST expects `*` as the ilike wildcard, not `%` —
  // a `%` there is eaten as percent-encoding and the pattern degrades to
  // "match anything", which silently returned the entire table.
  // Commas and parens are stripped because they delimit the or() group itself.
  if (req.query.q) {
    const term = String(req.query.q).trim().slice(0, 80).replace(/[%*,().\\]/g, '');
    if (term) q = q.or(`title.ilike.*${term}*,caption.ilike.*${term}*,category.ilike.*${term}*`);
  }

  // Featured first, then the manager's manual order, then newest.
  q = q.order('is_featured',   { ascending: false, nullsFirst: false })
       .order('display_order', { ascending: true })
       .order('created_at',    { ascending: false })
       .range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) return handleError(res, error);

  res.json({
    success: true,
    data: data.map(map.gallery),
    meta: { total: count ?? data.length, limit, offset, hasMore: offset + data.length < (count ?? 0) },
  });
});

// The consent notice, served rather than hardcoded in the page, so the wording
// the form shows and the version recorded against a review can never drift.
app.get('/api/reviews/consent', (req, res) => {
  res.json({ success: true, data: { version: CONSENT_VERSION, notice: CONSENT_NOTICE } });
});

// Aggregate rating summary. Computed here rather than in the browser so the
// page does not have to download every review just to average them.
app.get('/api/reviews/summary', async (req, res) => {
  let q = supabase.from('reviews').select('rating', { count: 'exact' }).eq('status', 'published');
  if (req.query.service) q = q.eq('service_id', req.query.service);

  const { data, error, count } = await q;
  if (error) return handleError(res, error);

  const dist = [1, 2, 3, 4, 5].reduce((a, n) => (a[n] = 0, a), {});
  data.forEach(r => { dist[r.rating] = (dist[r.rating] || 0) + 1; });
  const total = count ?? data.length;
  const avg   = total ? data.reduce((s, r) => s + r.rating, 0) / total : null;

  res.json({
    success: true,
    data: { total, average: avg === null ? null : Math.round(avg * 10) / 10, distribution: dist },
  });
});

// Public review list — published only, paginated, minimal fields.
app.get('/api/reviews', async (req, res) => {
  const { limit, offset } = reviewPageParams(req.query);

  let q = supabase.from('reviews').select('*', { count: 'exact' }).eq('status', 'published');
  if (req.query.service)             q = q.eq('service_id', req.query.service);
  if (req.query.rating)              q = q.eq('rating', parseInt(req.query.rating, 10) || 0);
  if (req.query.verified === 'true') q = q.eq('is_verified', true);

  q = q.order('is_featured', { ascending: false, nullsFirst: false })
       .order('created_at',  { ascending: false })
       .range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) return handleError(res, error);

  res.json({
    success: true,
    // publicReview, not review: the full legal name never leaves this process.
    data: data.map(map.publicReview),
    meta: { total: count ?? data.length, limit, offset, hasMore: offset + data.length < (count ?? 0) },
  });
});


// Marketing banners (active, within date range)
app.get('/api/banners', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.from('marketing_banners').select('*').eq('is_active', true).order('priority', { ascending: false });
  if (error) return handleError(res, error);
  const active = data.filter(b => (!b.start_date || b.start_date <= today) && (!b.end_date || b.end_date >= today));
  // publicBanner, not banner: our own view/click counts are not the visitor's
  // business and were previously in this payload.
  res.json({ success: true, data: active.map(map.publicBanner) });
});

// Aggregate impression / click counters.
//
// No cookie, no IP, no visitor identity — just an increment on the banner row.
// That keeps the marketer's CTR real while staying consistent with the data
// minimisation applied to reviews, and means there is nothing here to leak.
//
// The increment runs as a single atomic UPDATE inside bump_banner_metric().
// Read-then-write in this handler would drop counts under concurrent traffic,
// which is exactly when the number matters.
// Two explicit routes rather than one `:metric(view|click)` pattern — Express 5
// runs path-to-regexp v8, which removed inline regex in path parameters and
// throws at registration time on that syntax.
async function bumpBannerMetric(req, res, metric) {
  const { id } = req.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Invalid banner id' });

  const { error } = await supabase.rpc('bump_banner_metric', { p_id: id, p_metric: metric });
  // Deliberately 204 even on failure: this is fire-and-forget telemetry called
  // during a page render. A visitor must never see an error from it, and the
  // page must never wait on it.
  if (error) console.error('[MARKETING] metric bump failed:', error.message);
  res.status(204).end();
}

app.post('/api/banners/:id/view',  bannerMetricLimiter, (req, res) => bumpBannerMetric(req, res, 'view'));
app.post('/api/banners/:id/click', bannerMetricLimiter, (req, res) => bumpBannerMetric(req, res, 'click'));

// Check a promo code before the client commits to filling in the whole form.
app.post('/api/offers/validate', offerCheckLimiter, async (req, res) => {
  const result = await resolveOffer(req.body.code, {
    amount:   req.body.amount,
    services: Array.isArray(req.body.services) ? req.body.services : undefined,
  });

  if (!result.ok) return res.status(404).json({ success: false, error: result.reason });

  const o = result.offer;
  const discount = describeDiscount(o, req.body.amount);
  // Only what the client needs to see it worked. Not the cap, not the redemption
  // count, not the internal label — those would leak how the promotion is doing.
  res.json({
    success: true,
    data: {
      code: o.code.trim().toUpperCase(),
      description: o.description || discount.label,
      discountLabel: discount.label,
      amountOff: discount.amountOff,
      endsOn: o.ends_on,
    },
  });
});

// Posters (active, within date range)
app.get('/api/posters', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.from('posters').select('*').eq('is_active', true).order('display_order');
  if (error) return handleError(res, error);
  const active = data.filter(p => (!p.start_date || p.start_date <= today) && (!p.end_date || p.end_date >= today));
  // This was the one public endpoint returning raw snake_case rows, so posters
  // had a different shape from every other resource on the API. It now also
  // uses the public projection rather than the admin one — see map.publicPoster.
  res.json({ success: true, data: active.map(map.publicPoster) });
});

// Submit booking / enquiry (public)
//
// This is the ONLY channel that records an enquiry — the public form no longer
// falls back to WhatsApp for delivery, so this handler must never fail silently.
// It validates strictly, returns field-level errors the form can render inline,
// and survives schema drift rather than dropping the enquiry (see insertBooking).
app.post('/api/bookings', bookingLimiter, async (req, res) => {
  // Honeypot — real users never fill a hidden field. Bots do. Answer 201 with a
  // plausible-looking reference so the bot sees success and does not retry.
  if (req.body.company) {
    return res.status(201).json({ success: true, data: { bookingReference: 'LS-0000-000000', status: 'pending' } });
  }

  const errors = {};
  const name  = String(req.body.name  || '').trim();
  const phone = String(req.body.phone || '').trim();
  const email = String(req.body.email || '').trim();

  if (name.length < 2)   errors.name  = 'Please enter your full name.';
  if (name.length > 120) errors.name  = 'Name is too long.';

  // Kenyan mobile: 07XXXXXXXX / 01XXXXXXXX / +2547XXXXXXXX / 2541XXXXXXXX
  const phoneDigits = phone.replace(/[\s()-]/g, '');
  if (!/^(?:\+?254|0)[17]\d{8}$/.test(phoneDigits)) {
    errors.phone = 'Enter a valid Kenyan number, e.g. 0712 345 678.';
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    errors.email = 'That email address does not look right.';
  }

  // An event date in the past is almost always a typo — catch it at the door.
  const eventDate = req.body.eventDate || null;
  if (eventDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      errors.eventDate = 'Invalid date.';
    } else {
      const today = new Date().toISOString().split('T')[0];
      if (eventDate < today) errors.eventDate = 'Event date cannot be in the past.';
    }
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }

  // Normalise phone to canonical 2547XXXXXXXX so the same client is not stored
  // three different ways depending on how they typed it.
  const normalisedPhone = phoneDigits.replace(/^\+/, '').replace(/^0/, '254');

  const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const ua = req.headers['user-agent'] || '';

  const row = {
    name,
    phone:            normalisedPhone,
    email:            email || null,
    event_date:       eventDate,
    event_type:       req.body.eventType       || null,
    event_id:         req.body.eventId         || null,
    guest_count:      req.body.guestCount      || null,
    budget:           req.body.budget          || null,
    venue:            req.body.venue           || null,
    // services is text[] in Postgres. The form used to send a comma-joined
    // string, which Postgres rejected as a malformed array literal.
    services:         toTextArray(req.body.services),
    selected_package: req.body.selectedPackage || null,
    ticket_quantity:  req.body.ticketQuantity  || 1,
    total_amount:     req.body.totalAmount     || null,
    // The client's own special requests. Distinct from `notes`, which is the
    // internal staff-only field edited from the dashboard.
    event_details:    req.body.specialRequests || req.body.eventDetails || null,
    source:           req.body.source          || null,   // "How did you hear about us?"
    channel:          req.body.channel         || 'booking-form',
    status:           'pending',
    user_ip:          ip,
    user_agent:       ua,
  };

  const { data, error } = await insertBooking(row);
  if (error) return handleError(res, error);

  // Attribute the enquiry to real service rows.
  //
  // bookings.services stays as the text[] the form submits and the dashboard
  // displays, but it is no longer what analysis reads. It was: a live booking
  // said "Public Address System" while the service is "Public Address Systems",
  // so that enquiry was invisible to per-service reporting and the marketing
  // guidance wrongly called the service dormant. Keys, not strings, from here.
  //
  // Non-fatal by design: an enquiry is revenue, and losing one because a service
  // name did not resolve would be far worse than an unattributed row.
  if (Array.isArray(row.services) && row.services.length) {
    try {
      const { data: allSvcs } = await supabase.from('services').select('id, name');
      const norm = (s) => String(s || '').trim().toLowerCase().replace(/s$/, '');
      const links = [];
      for (const wanted of row.services) {
        const match = (allSvcs || []).find(s => norm(s.name) === norm(wanted));
        if (match && !links.some(l => l.service_id === match.id)) {
          links.push({ booking_id: data.id, service_id: match.id });
        } else if (!match) {
          console.warn(`[SERVICES] enquiry ${data.id} named "${wanted}", which matches no service.`);
        }
      }
      if (links.length) await supabase.from('booking_services').insert(links);
    } catch (e) {
      console.error('[SERVICES] attribution failed (non-fatal):', e.message);
    }
  }

  // Record the promo redemption, if any. Deliberately AFTER the booking insert
  // and deliberately non-fatal: an enquiry is revenue, and losing one because a
  // discount code could not be attributed would be a far worse outcome than an
  // unattributed campaign. The client is told whether it applied.
  let appliedOffer = null;
  if (req.body.promoCode) {
    const resolved = await resolveOffer(req.body.promoCode, { services: row.services || undefined });
    if (resolved.ok) {
      const o = resolved.offer;
      const { error: redErr } = await supabase.from('offer_redemptions').insert({
        offer_id: o.id, booking_id: data.id,
        code_used: normaliseCode(req.body.promoCode),
        discount_type: o.discount_type, discount_value: o.discount_value,
      });
      if (redErr) {
        console.error('[MARKETING] redemption not recorded:', redErr.message);
      } else {
        appliedOffer = { code: o.code.trim().toUpperCase(), ...describeDiscount(o, null) };
      }
    } else {
      // Surface it without failing: the enquiry is saved either way, and the
      // manager can honour a mistyped code by hand.
      appliedOffer = { rejected: true, reason: resolved.reason };
    }
  }

  const ref = data.booking_reference || data.id;
  const serviceList = (row.services || []).join(', ') || 'N/A';

  // await both: on Vercel serverless the function can freeze the moment the
  // response is sent, cancelling any in-flight promise that was not awaited.
  await Promise.allSettled([
    notifyAdmin(`🎉 NEW ENQUIRY!\n\nRef: ${ref}\nClient: ${name}\nPhone: ${normalisedPhone}\nEvent: ${row.event_type || 'N/A'} on ${row.event_date || 'TBD'}\nVenue: ${row.venue || 'N/A'}\nBudget: KES ${row.budget || 'N/A'}\nServices: ${serviceList}\n\n👉 Dashboard: ${process.env.FRONTEND_URL || ''}/admin/dashboard.html?tab=bookings`),
    createNotification('booking', 'New Enquiry', `${name} (${normalisedPhone}) — ${row.event_type || 'Event'} on ${row.event_date || 'TBD'}`, data.id, 'bookings'),
  ]);

  res.status(201).json({ success: true, data: { ...map.booking(data), offer: appliedOffer } });
});

// Submit a review (public). Always lands as 'pending' — a person reads it
// before anything appears on the site.
app.post('/api/reviews', reviewLimiter, async (req, res) => {
  // Honeypot. Real users never fill a hidden field; bots fill everything.
  // Answer 201 so the bot believes it succeeded and does not retry.
  if (req.body.website) {
    return res.status(201).json({ success: true, data: { status: 'pending' } });
  }

  const errors = {};
  const clientName = String(req.body.clientName || '').trim().replace(/\s+/g, ' ');
  const comment    = String(req.body.comment    || '').trim();
  const rating     = Number.parseInt(req.body.rating, 10);

  if (clientName.length < 2)   errors.clientName = 'Please tell us your name.';
  if (clientName.length > 120) errors.clientName = 'That name is too long.';

  // The old handler did parseInt(rating) with no check, so 'abc' became NaN and
  // went straight into the insert.
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.rating = 'Choose a rating from 1 to 5 stars.';
  }
  if (comment.length && comment.length < REVIEW_MIN_COMMENT) {
    errors.comment = `Please write at least ${REVIEW_MIN_COMMENT} characters, or leave the comment empty.`;
  }
  if (comment.length > REVIEW_MAX_COMMENT) {
    errors.comment = `Please keep your review under ${REVIEW_MAX_COMMENT} characters.`;
  }
  if (req.body.eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(req.body.eventDate)) {
    errors.eventDate = 'Invalid date.';
  }
  if (req.body.eventDate && req.body.eventDate > new Date().toISOString().split('T')[0]) {
    errors.eventDate = 'That date is in the future.';
  }

  // Consent is not a checkbox we log — it is the precondition for storing
  // someone's words under their name at all. Without it there is nothing to do.
  if (req.body.consentPublish !== true) {
    errors.consentPublish = 'We need your permission before we can publish your review.';
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }

  const showFullName = req.body.showFullName === true;
  const bookingId    = await matchBooking(req.body.bookingReference);
  const ip           = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const token        = newWithdrawalToken();

  const row = {
    client_name:      clientName,                                  // admin-only
    display_name:     toDisplayName(clientName, showFullName),     // public
    show_full_name:   showFullName,
    rating,
    comment:          comment || null,
    event_type:       req.body.eventType || null,
    event_date:       req.body.eventDate || null,
    service_id:       req.body.serviceId || null,
    booking_id:       bookingId,
    is_verified:      !!bookingId,
    status:           'pending',
    is_featured:      false,
    consent_publish:  true,
    consent_version:  CONSENT_VERSION,
    consented_at:     new Date().toISOString(),
    withdrawal_token: token,
    submitter_hash:   hashSubmitter(ip),
    user_agent:       (req.headers['user-agent'] || '').slice(0, 300),
  };

  const { data, error } = await supabase.from('reviews').insert(row).select().single();
  if (error) return handleError(res, error);

  const verifiedTag = bookingId ? ' ✅ VERIFIED CLIENT' : '';
  await Promise.allSettled([
    notifyAdmin(`⭐ NEW REVIEW — needs approval${verifiedTag}\n\nFrom: ${row.display_name}\nRating: ${'⭐'.repeat(rating)} (${rating}/5)\nEvent: ${row.event_type || 'N/A'}\n"${(comment || '(no comment)').slice(0, 140)}"\n\n👉 ${process.env.FRONTEND_URL || ''}/admin/dashboard.html?tab=reviews`),
    createNotification('review', 'New Review Submitted', `${row.display_name} left a ${rating}-star review — pending approval`, data.id, 'reviews'),
  ]);

  // The withdrawal link is returned exactly once, here. It is never stored in a
  // retrievable form for the manager and never sent by email, because we do not
  // collect an email address. If the reviewer loses it they can ask staff, who
  // can unpublish from the dashboard.
  res.status(201).json({
    success: true,
    data: {
      id: data.id,
      status: data.status,
      displayName: data.display_name,
      isVerified: data.is_verified,
      withdrawalPath: `/review-withdraw.html?token=${token}`,
    },
  });
});

// What is about to be withdrawn. Lets the confirmation page show the reviewer
// their own review before they act, rather than asking them to trust a link.
app.get('/api/reviews/withdraw/:token', async (req, res) => {
  const { data } = await supabase.from('reviews')
    .select('id, display_name, rating, comment, status, created_at, withdrawn_at')
    .eq('withdrawal_token', req.params.token).maybeSingle();

  if (!data) return res.status(404).json({ error: 'That withdrawal link is not valid. It may already have been used.' });

  res.json({
    success: true,
    data: {
      displayName: data.display_name, rating: data.rating, comment: data.comment,
      status: data.status, createdAt: data.created_at,
      alreadyWithdrawn: data.status === 'withdrawn',
    },
  });
});

// Withdraw. Takes effect immediately — no staff step, no waiting period.
app.post('/api/reviews/withdraw/:token', async (req, res) => {
  const { data: cur } = await supabase.from('reviews')
    .select('id, status').eq('withdrawal_token', req.params.token).maybeSingle();

  if (!cur) return res.status(404).json({ error: 'That withdrawal link is not valid.' });
  if (cur.status === 'withdrawn') return res.json({ success: true, data: { alreadyWithdrawn: true } });

  // consent_publish is cleared alongside the status change: the record should
  // reflect that permission was retracted, not merely that the row was hidden.
  const { error } = await supabase.from('reviews').update({
    status: 'withdrawn', consent_publish: false, withdrawn_at: new Date().toISOString(),
  }).eq('id', cur.id);

  if (error) return handleError(res, error);

  await createNotification('review', 'Review withdrawn',
    'A client used their private link to withdraw their review. It is no longer on the website.', cur.id, 'reviews');

  res.json({ success: true, data: { withdrawn: true } });
});

// ==================== ADMIN AUTH ====================
app.post('/api/admin/auth/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser   = process.env.ADMIN_USERNAME   || 'admin';
  const adminPass   = process.env.ADMIN_PASSWORD   || 'admin123';
  const managerUser = process.env.MANAGER_USERNAME;
  const managerPass = process.env.MANAGER_PASSWORD;

  // A third identity, separate from the owner's.
  //
  // The work log only means something if the person who did the work is not the
  // person who signs it off. With only `admin` and `manager` logins, the
  // developer and the owner shared one account and "the owner accepted this"
  // could not be evidenced. DEVELOPER_USERNAME gives a real separation of
  // duties: the developer records deliverables, the owner accepts them.
  const devUser = process.env.DEVELOPER_USERNAME;
  const devPass = process.env.DEVELOPER_PASSWORD;

  let role = null;
  if (username === adminUser && password === adminPass) role = 'admin';
  else if (managerUser && managerPass && username === managerUser && password === managerPass) role = 'manager';
  else if (devUser && devPass && username === devUser && password === devPass) role = 'developer';

  if (role) {
    // The people, not the job titles. "Administrator" is what a system calls
    // someone; Lawrence is what he is called. Environment variables so a name
    // can be corrected, or the manager replaced, without a code change and a
    // deploy — the defaults are the current team.
    const NAMES = {
      admin:     process.env.ADMIN_NAME     || 'Lawrence Gichaga',
      manager:   process.env.MANAGER_NAME   || 'Nyambura',
      developer: process.env.DEVELOPER_NAME || 'Developer',
    };
    const IDS   = { admin: 1, manager: 2, developer: 3 };
    const name    = NAMES[role];
    const payload = { id: IDS[role], username, name, role, loginTime: Date.now() };
    const token   = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { id: payload.id, name, role } });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// ==================== ADMIN — EVENTS ====================
app.get('/api/admin/events', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('events').select('*').order('date');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.event) });
});
app.post('/api/admin/events', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('events').insert(toEventDB(req.body)).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.event(data) });
});
app.put('/api/admin/events/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('events').update(toEventDB(req.body, true)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.event(data) });
});
app.delete('/api/admin/events/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('events').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — SERVICES ====================
app.get('/api/admin/services', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('services').select('*').order('display_order');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.service) });
});
app.post('/api/admin/services', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('services').insert(toServiceDB(req.body)).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.service(data) });
});
app.put('/api/admin/services/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('services').update(toServiceDB(req.body)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.service(data) });
});
app.delete('/api/admin/services/:id', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('services')
    .select('id, name').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Service not found' });

  // booking_services.service_id is ON DELETE RESTRICT, so a service with history
  // cannot be deleted — deliberately. Deleting it would erase the record of the
  // revenue it earned. Catch it here to explain why rather than surfacing a raw
  // foreign-key violation, and point at the action that is actually wanted.
  const { count } = await supabase.from('booking_services')
    .select('id', { count: 'exact', head: true }).eq('service_id', req.params.id);

  if ((count || 0) > 0) {
    return res.status(409).json({
      error: `${count} booking${count === 1 ? '' : 's'} reference "${cur.name}". Deactivate it instead — deleting would erase the record of revenue it earned.`,
    });
  }

  const { error } = await supabase.from('services').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — GALLERY ====================

// Full list including unpublished drafts. Paginated with a generous default —
// the dashboard grid wants everything, but not without a ceiling.
app.get('/api/admin/gallery', adminAuth, async (req, res) => {
  const { limit, offset } = pageParams(req.query, GALLERY_MAX_PAGE);

  let q = supabase.from('gallery').select('*', { count: 'exact' });
  if (req.query.category)             q = q.eq('category', req.query.category);
  if (req.query.type)                 q = q.eq('type', req.query.type);
  if (req.query.published === 'true')  q = q.eq('is_published', true);
  if (req.query.published === 'false') q = q.eq('is_published', false);
  if (req.query.q) q = q.ilike('title', `%${req.query.q}%`);

  q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) return handleError(res, error);
  res.json({
    success: true,
    data: data.map(map.gallery),
    meta: { total: count ?? data.length, limit, offset, hasMore: offset + data.length < (count ?? 0) },
  });
});

// Taxonomy for the dashboard's dropdowns — same table the public page reads,
// but unfiltered by count so the manager can file a photo under an empty category.
app.get('/api/admin/gallery/categories', adminAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('gallery_categories').select('*').eq('is_active', true).order('display_order');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.galleryCategory) });
});

// Mint a short-lived signed upload URL so the browser PUTs the file straight to
// Supabase Storage.
//
// This is the whole point of the rewrite. Vercel caps serverless request bodies
// at 4.5 MB, so the old flow — base64-encode the file and POST it as JSON —
// could not work for anything but small images, and stored the result in a
// Postgres text column regardless. Going direct to Storage removes both the
// size ceiling and the database bloat.
app.post('/api/admin/gallery/upload-url', adminAuth, async (req, res) => {
  const { fileName, mimeType, fileSize } = req.body;

  if (!GALLERY_MIME[mimeType]) {
    return res.status(400).json({
      error: `Unsupported file type${mimeType ? ` (${mimeType})` : ''}. Use JPG, PNG, WebP, GIF, MP4 or WebM.`,
    });
  }
  if (Number.isFinite(+fileSize) && +fileSize > GALLERY_MAX_BYTES) {
    return res.status(400).json({
      error: `File is ${(+fileSize / 1048576).toFixed(1)} MB — the limit is ${GALLERY_MAX_BYTES / 1048576} MB.`,
    });
  }

  const path = storageKey(fileName, mimeType);
  const { data, error } = await supabase.storage.from(GALLERY_BUCKET).createSignedUploadUrl(path);
  if (error) return handleError(res, error);

  const { data: pub } = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path);
  res.json({
    success: true,
    data: {
      path, token: data.token, signedUrl: data.signedUrl, publicUrl: pub.publicUrl,
      // The client MUST send this as a Cache-Control header on the PUT. A direct
      // upload does not inherit the bucket default, so without it every object
      // is served no-cache and each visitor re-downloads every photo. Storage
      // keys are content-addressed by timestamp, so a year is safe: replacing
      // an image writes a new key rather than mutating this one.
      cacheControl: 'max-age=31536000',
    },
  });
});

// Create a row for a file the browser has already pushed to Storage.
app.post('/api/admin/gallery', adminAuth, async (req, res) => {
  const errors = await validateGallery(req.body, { requireImage: true });
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }

  // New items land at the end of their category unless told otherwise, so an
  // upload never silently displaces the order the manager arranged.
  if (req.body.displayOrder === undefined) {
    const { data: last } = await supabase.from('gallery')
      .select('display_order').eq('category', req.body.category || 'General')
      .order('display_order', { ascending: false }).limit(1).maybeSingle();
    req.body.displayOrder = (last?.display_order || 0) + 10;
  }

  const { data, error } = await supabase.from('gallery').insert(toGalleryDB(req.body)).select().single();
  if (error) {
    // The row failed but the object is already in the bucket — clean it up so
    // the bucket does not accumulate files nothing references.
    await removeGalleryObject(req.body.storagePath);
    return handleError(res, error);
  }
  res.status(201).json({ success: true, data: map.gallery(data) });
});

// Bulk reorder. Registered before /:id so "reorder" is not parsed as an id.
app.patch('/api/admin/gallery/reorder', adminAuth, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : null;
  if (!items?.length) return res.status(400).json({ error: 'items array is required' });
  if (items.length > GALLERY_MAX_PAGE) {
    return res.status(400).json({ error: `Reorder at most ${GALLERY_MAX_PAGE} items at a time.` });
  }

  const results = await Promise.allSettled(items.map(it =>
    supabase.from('gallery').update({ display_order: +it.displayOrder || 0 }).eq('id', it.id)
  ));
  const failed = results.filter(r => r.status === 'rejected' || r.value?.error).length;
  if (failed) return res.status(500).json({ error: `${failed} of ${items.length} items could not be reordered.` });
  res.json({ success: true, data: { reordered: items.length } });
});

// Bulk publish / unpublish / feature / delete from the dashboard's selection UI.
app.post('/api/admin/gallery/bulk', adminAuth, async (req, res) => {
  const { action, ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  if (ids.length > GALLERY_MAX_PAGE) {
    return res.status(400).json({ error: `Act on at most ${GALLERY_MAX_PAGE} items at a time.` });
  }

  const patches = {
    publish:   { is_published: true },
    unpublish: { is_published: false },
    feature:   { is_featured: true },
    unfeature: { is_featured: false },
  };

  if (action === 'delete') {
    // Read paths first: once the rows are gone we cannot find the objects.
    const { data: rows } = await supabase.from('gallery').select('storage_path').in('id', ids);
    const { error } = await supabase.from('gallery').delete().in('id', ids);
    if (error) return handleError(res, error);
    await Promise.allSettled((rows || []).map(r => removeGalleryObject(r.storage_path)));
    return res.json({ success: true, data: { affected: ids.length } });
  }

  if (!patches[action]) {
    return res.status(400).json({ error: `action must be one of: ${Object.keys(patches).join(', ')}, delete` });
  }
  const { data, error } = await supabase.from('gallery').update(patches[action]).in('id', ids).select();
  if (error) return handleError(res, error);
  res.json({ success: true, data: { affected: data.length, items: data.map(map.gallery) } });
});

app.put('/api/admin/gallery/:id', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('gallery')
    .select('storage_path, image_url').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Gallery item not found' });

  // On edit the file is optional — the form may only be changing a caption.
  const errors = await validateGallery(req.body, { requireImage: false });
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }

  const { data, error } = await supabase.from('gallery')
    .update(toGalleryDB(req.body, true)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);

  // The image was replaced — drop the old object now that the row points elsewhere.
  if (req.body.storagePath && cur.storage_path && req.body.storagePath !== cur.storage_path) {
    await removeGalleryObject(cur.storage_path);
  }
  res.json({ success: true, data: map.gallery(data) });
});

app.patch('/api/admin/gallery/:id/feature', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('gallery').select('is_featured').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Gallery item not found' });
  const { data, error } = await supabase.from('gallery')
    .update({ is_featured: !cur.is_featured }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.gallery(data) });
});

app.patch('/api/admin/gallery/:id/publish', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('gallery').select('is_published').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Gallery item not found' });
  const { data, error } = await supabase.from('gallery')
    .update({ is_published: !cur.is_published }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.gallery(data) });
});

app.delete('/api/admin/gallery/:id', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('gallery')
    .select('storage_path').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Gallery item not found' });

  const { error } = await supabase.from('gallery').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);

  // Legacy rows point at repo-static /IMAGES/ files and carry no storage_path;
  // removeGalleryObject no-ops on those rather than trying to delete them.
  await removeGalleryObject(cur.storage_path);
  res.json({ success: true });
});

// ==================== ADMIN — REVIEWS ====================
const REVIEW_STATUSES = ['pending', 'published', 'rejected', 'withdrawn'];

app.get('/api/admin/reviews', adminAuth, async (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit, 10) || REVIEW_MAX_PAGE, 1), REVIEW_MAX_PAGE);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  let q = supabase.from('reviews').select('*', { count: 'exact' });
  if (req.query.status && REVIEW_STATUSES.includes(req.query.status)) q = q.eq('status', req.query.status);
  if (req.query.verified === 'true') q = q.eq('is_verified', true);

  // Pending first — the moderation queue is the reason this screen exists.
  q = q.order('status', { ascending: true })
       .order('created_at', { ascending: false })
       .range(offset, offset + limit - 1);

  const { data, error, count } = await q;
  if (error) return handleError(res, error);
  res.json({
    success: true,
    data: data.map(map.review),
    meta: { total: count ?? data.length, limit, offset, hasMore: offset + data.length < (count ?? 0) },
  });
});

// Single moderation entry point. One endpoint with an explicit target status
// beats four verbs that can each drift — and it makes the audit trail uniform.
app.patch('/api/admin/reviews/:id/status', adminAuth, async (req, res) => {
  const { status, rejectionReason } = req.body;
  if (!REVIEW_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${REVIEW_STATUSES.join(', ')}` });
  }

  const { data: cur } = await supabase.from('reviews')
    .select('id, consent_publish, status').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Review not found' });

  // Defence in depth. The DB constraint would reject this anyway, but a clear
  // message here beats a raw check_violation reaching the dashboard.
  if (status === 'published' && !cur.consent_publish) {
    return res.status(409).json({
      error: cur.status === 'withdrawn'
        ? 'This client withdrew their review. It cannot be republished without their permission.'
        : 'This review has no recorded consent, so it cannot be published.',
    });
  }

  const patch = {
    status,
    moderated_at: new Date().toISOString(),
    moderated_by: req.admin?.username || req.admin?.role || null,
    rejection_reason: status === 'rejected' ? (rejectionReason || null) : null,
  };

  const { data, error } = await supabase.from('reviews')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.review(data) });
});

// Kept for backwards compatibility with the existing dashboard button until the
// UI is redeployed; delegates to the status route's rules.
app.patch('/api/admin/reviews/:id/approve', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('reviews')
    .select('consent_publish').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Review not found' });
  if (!cur.consent_publish) return res.status(409).json({ error: 'This review has no recorded consent, so it cannot be published.' });

  const { data, error } = await supabase.from('reviews').update({
    status: 'published',
    moderated_at: new Date().toISOString(),
    moderated_by: req.admin?.username || req.admin?.role || null,
  }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.review(data) });
});

app.patch('/api/admin/reviews/:id/reply', adminAuth, async (req, res) => {
  const reply = req.body.reply === null ? null : String(req.body.reply ?? '').trim();
  if (reply !== null && !reply) return res.status(400).json({ error: 'Reply text is required' });
  if (reply && reply.length > 1000) return res.status(400).json({ error: 'Replies are limited to 1000 characters.' });

  const { data, error } = await supabase.from('reviews')
    .update({ admin_reply: reply }).eq('id', req.params.id).select().maybeSingle();
  if (error) return handleError(res, error);
  if (!data) return res.status(404).json({ error: 'Review not found' });
  res.json({ success: true, data: map.review(data) });
});

app.patch('/api/admin/reviews/:id/feature', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('reviews')
    .select('is_featured, status').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Review not found' });
  // Featuring something the public cannot see is a silent no-op that looks like
  // it worked — say so instead.
  if (!cur.is_featured && cur.status !== 'published') {
    return res.status(409).json({ error: 'Publish this review before featuring it.' });
  }
  const { data, error } = await supabase.from('reviews')
    .update({ is_featured: !cur.is_featured }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.review(data) });
});

app.post('/api/admin/reviews/bulk', adminAuth, async (req, res) => {
  const { action, ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  if (ids.length > REVIEW_MAX_PAGE) return res.status(400).json({ error: `Act on at most ${REVIEW_MAX_PAGE} at a time.` });

  if (action === 'delete') {
    const { error } = await supabase.from('reviews').delete().in('id', ids);
    if (error) return handleError(res, error);
    return res.json({ success: true, data: { affected: ids.length } });
  }

  const target = { publish: 'published', reject: 'rejected', unpublish: 'pending' }[action];
  if (!target) return res.status(400).json({ error: 'action must be one of: publish, reject, unpublish, delete' });

  // Publishing in bulk must not become a way around consent. Filter to rows
  // that actually carry it and report the difference rather than failing whole.
  let eligible = ids;
  if (target === 'published') {
    const { data: rows } = await supabase.from('reviews')
      .select('id').in('id', ids).eq('consent_publish', true);
    eligible = (rows || []).map(r => r.id);
  }
  if (!eligible.length) {
    return res.status(409).json({ error: 'None of the selected reviews have recorded consent to publish.' });
  }

  const { data, error } = await supabase.from('reviews').update({
    status: target,
    moderated_at: new Date().toISOString(),
    moderated_by: req.admin?.username || req.admin?.role || null,
  }).in('id', eligible).select();
  if (error) return handleError(res, error);

  res.json({
    success: true,
    data: { affected: data.length, skipped: ids.length - eligible.length, items: data.map(map.review) },
  });
});
app.delete('/api/admin/reviews/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('reviews').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== PRICE DISPLAY POLICY ====================
//
// How much pricing a visitor sees, decided per service.
//
// The concern behind this: a client with a small event sees a large package
// price and leaves. Deleting packages would have "fixed" that by returning the
// site to showing no price at all — which loses the customers who compare
// suppliers and choose whoever published one, a loss that leaves no trace.
//
// So packages stay as data and the display becomes policy. Crucially the
// suppression happens HERE, not in the page: a price hidden with CSS is still
// in the network response for anyone who opens developer tools, and "we do not
// publish prices" has to actually mean it.

const PRICE_DISPLAY_MODES = ['from', 'range', 'on_request'];

function applyPriceDisplay(service, packages) {
  const mode = PRICE_DISPLAY_MODES.includes(service.price_display) ? service.price_display : 'from';
  const active = (packages || []).filter(p => p.is_active !== false);
  const prices = active.map(p => p.price).filter(p => p !== null && p !== undefined).map(Number);

  if (mode === 'on_request') {
    return {
      priceDisplay: mode,
      // Package names and contents still ship — a client should be able to see
      // WHAT is offered even when the figure is quote-only. Only the numbers go.
      packages: active.map(p => ({ ...map.servicePackage(p), price: null })),
      priceSummary: { mode, fromPrice: null, topPrice: null, label: 'Price on request' },
    };
  }

  const from = prices.length ? Math.min(...prices) : null;
  const top  = prices.length ? Math.max(...prices) : null;

  return {
    priceDisplay: mode,
    packages: active.map(map.servicePackage),
    priceSummary: {
      mode,
      fromPrice: from,
      topPrice: mode === 'range' ? top : null,
      label: from === null
        ? 'Price on request'
        : mode === 'range' && top !== null && top !== from
          ? `KES ${from.toLocaleString('en-KE')} – ${top.toLocaleString('en-KE')}`
          : `From KES ${from.toLocaleString('en-KE')}`,
    },
  };
}

// ==================== ADMIN — SERVICE PACKAGES ====================
//
// Packages used to live in a JSONB array on the service and were addressed by
// array index, so editPackage(2) meant "whatever is third right now". Reordering
// or a concurrent edit hit the wrong one, and saving a package rewrote the whole
// service — last write wins, and the other person's package vanished silently.
//
// These are rows with stable ids. Editing one package touches one row.

function validatePackage(body, { isUpdate = false } = {}) {
  const errors = {};
  const name = String(body.name ?? '').trim();

  if (!isUpdate || body.name !== undefined) {
    if (name.length < 2)  errors.name = 'Give the package a name clients will understand.';
    if (name.length > 80) errors.name = 'That name is too long for a package card.';
  }
  // Blank price is legitimate — bespoke work is quoted, not listed. It is
  // distinct from a price of zero, which would read as free.
  if (body.price !== undefined && body.price !== null && body.price !== '') {
    const p = Number(body.price);
    if (!Number.isFinite(p) || p < 0)   errors.price = 'Enter a price in KES, or leave it blank for "contact us".';
    else if (p > 100000000)             errors.price = 'That price looks wrong — check for an extra digit.';
  }
  if (body.features !== undefined && !Array.isArray(body.features) && typeof body.features !== 'string') {
    errors.features = 'Features must be a list.';
  }
  return errors;
}

function toPackageDB(b) {
  const row = {};
  if (b.name !== undefined)     row.name = String(b.name).trim();
  if (b.duration !== undefined) row.duration = b.duration?.trim() || null;
  if (b.price !== undefined) {
    row.price = (b.price === null || b.price === '') ? null : Number(b.price);
  }
  if (b.features !== undefined) {
    const list = Array.isArray(b.features) ? b.features : String(b.features).split('\n');
    row.features = list.map(f => String(f).trim()).filter(Boolean).slice(0, 40);
  }
  if (b.displayOrder !== undefined) row.display_order = Number(b.displayOrder) || 0;
  if (b.isActive  !== undefined) row.is_active  = b.isActive !== false;
  if (b.isPopular !== undefined) row.is_popular = b.isPopular === true;
  return row;
}

// Who is making the change, carried as a column so it lands in the same
// statement as the price and the history trigger can read it. A session setting
// would not survive: PostgREST runs each request in its own transaction.
function actorOf(req) {
  return req.admin?.username || req.admin?.role || 'unknown';
}

app.get('/api/admin/services/:id/packages', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('service_packages')
    .select('*').eq('service_id', req.params.id).order('display_order');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.servicePackage) });
});

app.post('/api/admin/services/:id/packages', adminAuth, async (req, res) => {
  const errors = validatePackage(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }
  const { data: svc } = await supabase.from('services').select('id').eq('id', req.params.id).maybeSingle();
  if (!svc) return res.status(404).json({ error: 'Service not found' });

  const row = toPackageDB(req.body);
  row.service_id = req.params.id;
  if (row.display_order === undefined) {
    const { data: last } = await supabase.from('service_packages')
      .select('display_order').eq('service_id', req.params.id)
      .order('display_order', { ascending: false }).limit(1).maybeSingle();
    row.display_order = (last?.display_order || 0) + 10;
  }

  // Only one package per service may be flagged popular; a partial unique index
  // enforces it, so clear the previous one rather than letting the insert fail.
  if (row.is_popular) {
    await supabase.from('service_packages').update({ is_popular: false }).eq('service_id', req.params.id);
  }

  row.updated_by = actorOf(req);
  const { data, error } = await supabase.from('service_packages').insert(row).select().single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This service already has a package with that name.', fields: { name: 'Already used.' } });
    }
    return handleError(res, error);
  }
  res.status(201).json({ success: true, data: map.servicePackage(data) });
});

app.put('/api/admin/packages/:pkgId', adminAuth, async (req, res) => {
  const errors = validatePackage(req.body, { isUpdate: true });
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }
  const { data: cur } = await supabase.from('service_packages')
    .select('id, service_id').eq('id', req.params.pkgId).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Package not found' });

  const row = toPackageDB(req.body);
  if (row.is_popular) {
    await supabase.from('service_packages').update({ is_popular: false })
      .eq('service_id', cur.service_id).neq('id', cur.id);
  }

  row.updated_by = actorOf(req);
  const { data, error } = await supabase.from('service_packages')
    .update(row).eq('id', req.params.pkgId).select().single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This service already has a package with that name.', fields: { name: 'Already used.' } });
    }
    return handleError(res, error);
  }
  res.json({ success: true, data: map.servicePackage(data) });
});

app.delete('/api/admin/packages/:pkgId', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('service_packages')
    .select('id').eq('id', req.params.pkgId).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Package not found' });

  // A package a client actually chose is part of the revenue record. Deactivate
  // keeps it out of the website while preserving what was sold.
  const { count } = await supabase.from('booking_services')
    .select('id', { count: 'exact', head: true }).eq('package_id', req.params.pkgId);

  if ((count || 0) > 0 && req.query.force !== 'true') {
    return res.status(409).json({
      error: `${count} booking${count === 1 ? '' : 's'} chose this package. Deactivate it instead so the sales record stays intact.`,
    });
  }
  const { error } = await supabase.from('service_packages').delete().eq('id', req.params.pkgId);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

app.patch('/api/admin/services/:id/packages/reorder', adminAuth, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : null;
  if (!items?.length) return res.status(400).json({ error: 'items array is required' });

  const results = await Promise.allSettled(items.map(it =>
    supabase.from('service_packages')
      .update({ display_order: Number(it.displayOrder) || 0 })
      .eq('id', it.id).eq('service_id', req.params.id)
  ));
  const failed = results.filter(r => r.status === 'rejected' || r.value?.error).length;
  if (failed) return res.status(500).json({ error: `${failed} of ${items.length} packages could not be reordered.` });
  res.json({ success: true, data: { reordered: items.length } });
});

// Price history. The reason the trigger exists: "we raised the price in March,
// did enquiries fall?" is otherwise a matter of memory.
app.get('/api/admin/packages/:pkgId/price-history', adminAuth, adminOnly, async (req, res) => {
  const { data, error } = await supabase.from('package_price_history')
    .select('*').eq('package_id', req.params.pkgId).order('changed_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({
    success: true,
    data: (data || []).map(r => ({
      id: r.id,
      oldPrice: r.old_price === null ? null : Number(r.old_price),
      newPrice: r.new_price === null ? null : Number(r.new_price),
      changedBy: r.changed_by, changedAt: r.changed_at,
    })),
  });
});

// Per-service revenue and demand. adminOnly for the same reason analytics is:
// these are margins and revenue, not operational data.
app.get('/api/admin/services/performance', adminAuth, adminOnly, async (req, res) => {
  const iso = d => d.toISOString().split('T')[0];
  const today = new Date();
  const defFrom = new Date(today); defFrom.setDate(defFrom.getDate() - 89);

  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : iso(defFrom);
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to   || '') ? req.query.to   : iso(today);
  if (from > to) return res.status(400).json({ error: 'The start date must be on or before the end date.' });

  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > ANALYTICS_MAX_DAYS) {
    return res.status(400).json({ error: `Choose a range of ${ANALYTICS_MAX_DAYS} days or fewer.` });
  }

  const { data, error } = await supabase.rpc('service_performance', { p_from: from, p_to: to });
  if (error) return handleError(res, error);
  res.json({ success: true, data });
});

// ==================== ADMIN — OFFERS ====================
//
// Offers are the discount model the section was missing. A banner could always
// say "10% off" as free text, but nothing recorded that an offer existed, who
// used it, or what it cost — so no campaign could be evaluated and discount
// guidance had nothing to stand on.

async function validateOffer(body, { isUpdate = false } = {}) {
  const errors = {};
  const code  = normaliseCode(body.code);
  const label = String(body.label || '').trim();
  const type  = body.discountType === 'fixed' ? 'fixed' : 'percent';
  const value = Number(body.discountValue);

  if (!isUpdate || body.code !== undefined) {
    if (code.length < 3)  errors.code = 'Give the code at least 3 characters.';
    // Clients type these from a poster or a WhatsApp message. Punctuation and
    // spaces get mistyped and mis-transcribed, so restrict to what survives.
    else if (!/^[A-Z0-9]+$/.test(code)) errors.code = 'Use letters and numbers only — no spaces or punctuation.';
  }
  if (!isUpdate || body.label !== undefined) {
    if (label.length < 2) errors.label = 'Give this offer a name you will recognise later.';
  }
  if (!isUpdate || body.discountValue !== undefined) {
    if (!Number.isFinite(value) || value <= 0) errors.discountValue = 'Enter a discount greater than zero.';
    else if (type === 'percent' && value > 100) errors.discountValue = 'A percentage cannot exceed 100.';
    else if (type === 'percent' && value > 50)  errors.discountValue = `${value}% is a very large discount — enter 50 or less, or use a fixed amount if you really mean it.`;
  }
  if (body.startsOn && !/^\d{4}-\d{2}-\d{2}$/.test(body.startsOn)) errors.startsOn = 'Invalid date.';
  if (body.endsOn   && !/^\d{4}-\d{2}-\d{2}$/.test(body.endsOn))   errors.endsOn   = 'Invalid date.';
  if (body.startsOn && body.endsOn && body.endsOn < body.startsOn) {
    errors.endsOn = 'The end date must be on or after the start date.';
  }
  if (body.maxRedemptions !== undefined && body.maxRedemptions !== null && body.maxRedemptions !== '') {
    const cap = Number(body.maxRedemptions);
    if (!Number.isInteger(cap) || cap < 1) errors.maxRedemptions = 'A cap must be a whole number of 1 or more.';
  }
  return errors;
}

function toOfferDB(b, isUpdate = false) {
  const row = {};
  if (b.code  !== undefined) row.code  = normaliseCode(b.code);
  if (b.label !== undefined) row.label = String(b.label).trim();
  if (b.description !== undefined) row.description = b.description?.trim() || null;
  if (b.discountType  !== undefined) row.discount_type  = b.discountType === 'fixed' ? 'fixed' : 'percent';
  if (b.discountValue !== undefined) row.discount_value = Number(b.discountValue);
  if (b.minAmount !== undefined) row.min_amount = b.minAmount === '' || b.minAmount === null ? null : Number(b.minAmount);
  if (b.appliesTo !== undefined) row.applies_to = Array.isArray(b.appliesTo) && b.appliesTo.length ? b.appliesTo : null;
  if (b.startsOn !== undefined) row.starts_on = b.startsOn || new Date().toISOString().split('T')[0];
  if (b.endsOn   !== undefined) row.ends_on   = b.endsOn || null;
  if (b.maxRedemptions !== undefined) {
    row.max_redemptions = b.maxRedemptions === '' || b.maxRedemptions === null ? null : Number(b.maxRedemptions);
  }
  if (b.isActive !== undefined) row.is_active = b.isActive !== false;
  if (b.notes    !== undefined) row.notes = b.notes?.trim() || null;
  // times_redeemed is never written from a payload — the redemption trigger owns
  // it. Including it here would let an edit reset a campaign's history, the same
  // bug that used to zero events.booking_count.
  return row;
}

app.get('/api/admin/offers', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('offers').select('*').order('created_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.offer) });
});

app.post('/api/admin/offers', adminAuth, async (req, res) => {
  const errors = await validateOffer(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }
  const row = toOfferDB(req.body);
  row.created_by = req.admin?.username || req.admin?.role || null;

  const { data, error } = await supabase.from('offers').insert(row).select().single();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That code is already in use.', fields: { code: 'Already in use.' } });
    }
    return handleError(res, error);
  }
  res.status(201).json({ success: true, data: map.offer(data) });
});

app.put('/api/admin/offers/:id', adminAuth, async (req, res) => {
  const errors = await validateOffer(req.body, { isUpdate: true });
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }
  const { data, error } = await supabase.from('offers')
    .update(toOfferDB(req.body, true)).eq('id', req.params.id).select().maybeSingle();
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'That code is already in use.', fields: { code: 'Already in use.' } });
    }
    return handleError(res, error);
  }
  if (!data) return res.status(404).json({ error: 'Offer not found' });
  res.json({ success: true, data: map.offer(data) });
});

app.patch('/api/admin/offers/:id/toggle', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('offers').select('is_active').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Offer not found' });
  const { data, error } = await supabase.from('offers')
    .update({ is_active: !cur.is_active }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.offer(data) });
});

app.get('/api/admin/offers/:id/redemptions', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('offer_redemptions')
    .select('id, booking_id, code_used, discount_type, discount_value, redeemed_at, bookings(name, booking_reference, status, agreed_amount)')
    .eq('offer_id', req.params.id).order('redeemed_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({
    success: true,
    data: (data || []).map(r => ({
      id: r.id, bookingId: r.booking_id, codeUsed: r.code_used,
      discountType: r.discount_type, discountValue: Number(r.discount_value),
      redeemedAt: r.redeemed_at,
      client: r.bookings?.name || null,
      bookingReference: r.bookings?.booking_reference || null,
      bookingStatus: r.bookings?.status || null,
      agreedAmount: r.bookings?.agreed_amount === null || r.bookings?.agreed_amount === undefined
        ? null : Number(r.bookings.agreed_amount),
    })),
  });
});

app.delete('/api/admin/offers/:id', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('offers')
    .select('times_redeemed').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Offer not found' });

  // Deleting cascades the redemption rows, which erases the record of which
  // bookings came from this campaign. Deactivating keeps the history.
  if (cur.times_redeemed > 0 && req.query.force !== 'true') {
    return res.status(409).json({
      error: `This offer has ${cur.times_redeemed} redemption${cur.times_redeemed === 1 ? '' : 's'}. Deactivate it instead to keep the record of which bookings used it.`,
    });
  }
  const { error } = await supabase.from('offers').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// Discount guidance. adminOnly: the signals behind it are revenue, outstanding
// balances and margins — the same line already drawn around payroll and analytics.
app.get('/api/admin/marketing/guidance', adminAuth, adminOnly, async (req, res) => {
  const { data, error } = await supabase.rpc('marketing_guidance');
  if (error) return handleError(res, error);
  res.json({ success: true, data });
});

// ==================== ADMIN — MARKETING BANNERS ====================
app.get('/api/admin/banners', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('marketing_banners').select('*').order('created_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.banner) });
});
// Banner create/update had no validation at all. The message is what every
// visitor reads, and cta_link goes straight into an href on the homepage.
function validateBanner(body, { isUpdate = false } = {}) {
  const errors = {};
  const message = String(body.message ?? '').trim();

  if (!isUpdate || body.message !== undefined) {
    if (message.length < 4)   errors.message = 'Write the message visitors will see.';
    // The bar is one line on a phone. Longer text truncates or wraps badly, so
    // this is a design constraint rather than an arbitrary limit.
    if (message.length > 160) errors.message = `Keep it under 160 characters for the banner bar (currently ${message.length}).`;
  }
  if (body.ctaLink !== undefined && !isSafeCtaLink(body.ctaLink)) {
    errors.ctaLink = 'Use a page on this site (like /booking.html) or a full https:// address.';
  }
  if (body.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.startDate)) errors.startDate = 'Invalid date.';
  if (body.endDate   && !/^\d{4}-\d{2}-\d{2}$/.test(body.endDate))   errors.endDate   = 'Invalid date.';
  if (body.startDate && body.endDate && body.endDate < body.startDate) {
    errors.endDate = 'The end date must be on or after the start date.';
  }
  return errors;
}

app.post('/api/admin/banners', adminAuth, async (req, res) => {
  const errors = validateBanner(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }
  const row = toBannerDB(req.body);
  if (req.body.offerId !== undefined) row.offer_id = req.body.offerId || null;
  if (req.body.style   !== undefined) row.style    = req.body.style || 'bar';

  const { data, error } = await supabase.from('marketing_banners').insert(row).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.banner(data) });
});

app.put('/api/admin/banners/:id', adminAuth, async (req, res) => {
  const errors = validateBanner(req.body, { isUpdate: true });
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }
  const row = toBannerDB(req.body, true);
  if (req.body.offerId !== undefined) row.offer_id = req.body.offerId || null;
  if (req.body.style   !== undefined) row.style    = req.body.style || 'bar';

  const { data, error } = await supabase.from('marketing_banners')
    .update(row).eq('id', req.params.id).select().maybeSingle();
  if (error) return handleError(res, error);
  if (!data) return res.status(404).json({ error: 'Banner not found' });
  res.json({ success: true, data: map.banner(data) });
});

app.patch('/api/admin/banners/:id/toggle', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('marketing_banners')
    .select('is_active').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Banner not found' });
  const { data, error } = await supabase.from('marketing_banners')
    .update({ is_active: !cur.is_active }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.banner(data) });
});
app.delete('/api/admin/banners/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('marketing_banners').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — POSTERS ====================
// A poster is a still or a video the homepage shows to visitors. Validation
// returns a field->message map so the dashboard can mark the offending input
// instead of showing "Save Failed" over a form the manager must then re-read.
function validatePoster(body, { isUpdate = false } = {}) {
  const errors = {};
  const title = String(body.title || '').trim();
  const url   = String(body.imageUrl || '').trim();
  const type  = body.mediaType === 'video' ? 'video' : 'image';

  if (!title) errors.title = 'Give the poster a title.';
  else if (title.length > 120) errors.title = 'Keep the title under 120 characters.';

  if (!url) {
    errors.imageUrl = type === 'video' ? 'Upload a video or paste a link.' : 'Upload an image or paste a link.';
  } else if (/^data:/i.test(url)) {
    // Belt and braces with the database CHECK. A data: URI here would be stored
    // in Postgres and re-sent to every homepage visitor in full.
    errors.imageUrl = 'Inline image data is not accepted. Upload the file instead.';
  } else if (!/^https?:\/\//i.test(url)) {
    errors.imageUrl = 'Must be a full link starting with https://';
  } else if (url.length > 2048) {
    errors.imageUrl = 'That link is too long.';
  }

  // A hosted video needs a still to show before it plays and when autoplay is
  // refused. Embeds (YouTube/Vimeo) carry their own, so they are exempt.
  if (type === 'video' && url && !/(youtube|youtu\.be|vimeo)/i.test(url) && !String(body.thumbUrl || '').trim()) {
    errors.imageUrl = 'This video has no preview frame. Re-upload it so one can be generated.';
  }

  if (String(body.caption || '').length > 100) errors.caption = 'Keep the caption under 100 characters.';

  const start = body.startDate || null, end = body.endDate || null;
  if (start && end && end < start) errors.endDate = 'The end date is before the start date.';

  const order = body.displayOrder;
  if (order !== undefined && order !== null && order !== '' && !Number.isFinite(+order)) {
    errors.displayOrder = 'Display order must be a number.';
  }

  return { errors, valid: Object.keys(errors).length === 0 };
}

function toPosterDB(b) {
  const type = b.mediaType === 'video' ? 'video' : 'image';
  return {
    title:        String(b.title || '').trim(),
    image_url:    String(b.imageUrl || '').trim(),
    caption:      b.caption ? String(b.caption).trim() : null,
    media_type:   type,
    storage_path: b.storagePath || null,
    thumb_url:    b.thumbUrl  || null,
    thumb_path:   b.thumbPath || null,
    mime_type:    b.mimeType || null,
    file_size:    Number.isFinite(+b.fileSize) ? +b.fileSize : null,
    width:        Number.isFinite(+b.width)  ? +b.width  : null,
    height:       Number.isFinite(+b.height) ? +b.height : null,
    is_active:    b.isActive !== false,
    start_date:   b.startDate || null,
    end_date:     b.endDate   || null,
    display_order: Number.isFinite(+b.displayOrder) ? +b.displayOrder : 0,
  };
}

// Same direct-to-Storage flow as the gallery: the browser PUTs the file to
// Supabase itself. Vercel caps a serverless request body at 4.5 MB, so routing
// a video through the API was never going to work — which is why the form only
// ever offered a URL box for video.
app.post('/api/admin/posters/upload-url', adminAuth, async (req, res) => {
  const { fileName, mimeType, fileSize } = req.body;

  if (!GALLERY_MIME[mimeType]) {
    return res.status(400).json({
      error: `Unsupported file type${mimeType ? ` (${mimeType})` : ''}. Use JPG, PNG, WebP, GIF, MP4 or WebM.`,
      fields: { imageUrl: 'That file type is not supported.' },
    });
  }
  if (Number.isFinite(+fileSize) && +fileSize > GALLERY_MAX_BYTES) {
    return res.status(400).json({
      error: `File is ${(+fileSize / 1048576).toFixed(1)} MB — the limit is ${GALLERY_MAX_BYTES / 1048576} MB.`,
      fields: { imageUrl: `That file is ${(+fileSize / 1048576).toFixed(1)} MB. The limit is ${GALLERY_MAX_BYTES / 1048576} MB.` },
    });
  }

  const path = storageKey(fileName, mimeType, POSTER_PREFIX);
  const { data, error } = await supabase.storage.from(GALLERY_BUCKET).createSignedUploadUrl(path);
  if (error) return handleError(res, error);

  const { data: pub } = supabase.storage.from(GALLERY_BUCKET).getPublicUrl(path);
  res.json({
    success: true,
    data: { path, token: data.token, signedUrl: data.signedUrl, publicUrl: pub.publicUrl, cacheControl: 'max-age=31536000' },
  });
});

app.get('/api/admin/posters', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('posters').select('*').order('display_order');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.poster) });
});

app.post('/api/admin/posters', adminAuth, async (req, res) => {
  const { errors, valid } = validatePoster(req.body);
  if (!valid) return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });

  const { data, error } = await supabase.from('posters').insert(toPosterDB(req.body)).select().single();
  if (error) {
    // The upload already landed in Storage. Nothing references it now, so drop
    // it rather than leaving an object nobody can see or delete.
    await removeGalleryObject(req.body.storagePath);
    return handleError(res, error);
  }
  res.status(201).json({ success: true, data: map.poster(data) });
});

app.put('/api/admin/posters/:id', adminAuth, async (req, res) => {
  const { errors, valid } = validatePoster(req.body, { isUpdate: true });
  if (!valid) return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });

  const { data: cur } = await supabase.from('posters').select('storage_path, thumb_path').eq('id', req.params.id).single();

  const { data, error } = await supabase.from('posters')
    .update(toPosterDB(req.body)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);

  // Media was replaced: the old objects are now unreferenced. Removed after the
  // row is safely updated, so a failed write never destroys the live poster.
  if (cur?.storage_path && cur.storage_path !== data.storage_path) {
    await removeGalleryObject(cur.storage_path);
  }
  if (cur?.thumb_path && cur.thumb_path !== data.thumb_path) {
    await removeGalleryObject(cur.thumb_path);
  }
  res.json({ success: true, data: map.poster(data) });
});

app.patch('/api/admin/posters/:id/toggle', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('posters').select('is_active').eq('id', req.params.id).single();
  if (!cur) return res.status(404).json({ error: 'Poster not found' });
  const { data, error } = await supabase.from('posters').update({ is_active: !cur.is_active }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.poster(data) });
});

app.delete('/api/admin/posters/:id', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('posters').select('storage_path, thumb_path').eq('id', req.params.id).single();
  const { error } = await supabase.from('posters').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  // Delete the row first: an object without a row is invisible clutter, but a
  // row pointing at a deleted object is a broken poster on the homepage.
  await removeGalleryObject(cur?.storage_path);
  await removeGalleryObject(cur?.thumb_path);
  res.json({ success: true });
});

// ==================== ADMIN — BOOKINGS ====================
app.get('/api/admin/bookings', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('bookings').select('*').order('created_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.booking) });
});
const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];

app.patch('/api/admin/bookings/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  // Guard the enum: the dashboard pipeline only renders these four keys, so an
  // unexpected value would make the enquiry disappear from the board entirely.
  if (!BOOKING_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${BOOKING_STATUSES.join(', ')}` });
  }
  const patch = { status };
  // Stamp the first move off 'pending' as the first response, so the 2-hour
  // promise on the public site becomes a measurable number.
  if (status !== 'pending') {
    const { data: cur } = await supabase.from('bookings').select('responded_at').eq('id', req.params.id).single();
    if (!cur?.responded_at) {
      patch.responded_at = new Date().toISOString();
      patch.handled_by   = req.admin?.username || req.admin?.role || null;
    }
  }
  const { data, error } = await updateBooking(req.params.id, patch);
  if (error) return handleError(res, error);
  if (!data) return res.status(404).json({ error: 'Enquiry not found' });
  res.json({ success: true, data: map.booking(data) });
});

app.patch('/api/admin/bookings/:id/notes', adminAuth, async (req, res) => {
  const { notes } = req.body;
  if (notes === undefined) return res.status(400).json({ error: 'notes field is required' });
  if (String(notes).length > 5000) return res.status(400).json({ error: 'Notes are limited to 5000 characters.' });

  const { data, error } = await updateBooking(req.params.id, {
    notes,
    handled_by: req.admin?.username || req.admin?.role || null,
  });

  if (error) {
    // Unlike metadata, a note is text a person typed. If the column is missing
    // we must say so plainly rather than report a success that saved nothing.
    if (error.code === 'PGRST204' && (error.message || '').includes("'notes'")) {
      return res.status(503).json({
        error: 'Notes are not available yet — the database is missing the "notes" column. ' +
               'Run database/migrations/2026-07-27_final_audit_cleanup.sql in Supabase, then try again.',
      });
    }
    return handleError(res, error);
  }
  if (!data) return res.status(404).json({ error: 'Enquiry not found' });
  res.json({ success: true, data: map.booking(data) });
});
app.delete('/api/admin/bookings/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('bookings').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — EMPLOYEES ====================
app.get('/api/admin/employees', adminAuth, adminOnly, async (req, res) => {
  const { data, error } = await supabase.from('employees').select('*').order('name');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.employee) });
});
app.post('/api/admin/employees', adminAuth, adminOnly, async (req, res) => {
  const { data, error } = await supabase.from('employees').insert(toEmployeeDB(req.body)).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.employee(data) });
});
app.put('/api/admin/employees/:id', adminAuth, adminOnly, async (req, res) => {
  const { data, error } = await supabase.from('employees').update(toEmployeeDB(req.body)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.employee(data) });
});
app.delete('/api/admin/employees/:id', adminAuth, adminOnly, async (req, res) => {
  await supabase.from('payroll').delete().eq('employee_id', req.params.id);
  const { error } = await supabase.from('employees').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — PAYROLL ====================
app.get('/api/admin/payroll', adminAuth, adminOnly, async (req, res) => {
  const { data, error } = await supabase.from('payroll').select('*').order('created_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.payroll) });
});
app.post('/api/admin/payroll', adminAuth, adminOnly, async (req, res) => {
  const { data, error } = await supabase.from('payroll').insert(toPayrollDB(req.body)).select().single();
  if (error) return handleError(res, error);
  await syncEmployeeStats(req.body.employeeId);
  res.status(201).json({ success: true, data: map.payroll(data) });
});
app.put('/api/admin/payroll/:id', adminAuth, adminOnly, async (req, res) => {
  const { data, error } = await supabase.from('payroll').update(toPayrollDB(req.body)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  await syncEmployeeStats(req.body.employeeId);
  res.json({ success: true, data: map.payroll(data) });
});
app.delete('/api/admin/payroll/:id', adminAuth, adminOnly, async (req, res) => {
  const { data: rec } = await supabase.from('payroll').select('employee_id').eq('id', req.params.id).single();
  const { error } = await supabase.from('payroll').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  if (rec?.employee_id) await syncEmployeeStats(rec.employee_id);
  res.json({ success: true });
});

// ==================== ADMIN — NOTIFICATIONS ====================
app.get('/api/admin/notifications', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.notification) });
});
app.patch('/api/admin/notifications/:id/read', adminAuth, async (req, res) => {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});
app.patch('/api/admin/notifications/read-all', adminAuth, async (req, res) => {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
  if (error) return handleError(res, error);
  res.json({ success: true });
});
app.delete('/api/admin/notifications/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('notifications').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — SETTINGS ====================
app.get('/api/admin/settings', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('settings').select('*').order('key');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.setting) });
});
app.patch('/api/admin/settings/:key', adminAuth, async (req, res) => {
  const { value } = req.body;
  if (value === undefined) return res.status(400).json({ error: 'value is required' });
  const { data, error } = await supabase.from('settings').update({ value }).eq('key', req.params.key).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.setting(data) });
});

// ==================== ADMIN — WORK LOG ====================
//
// A register of work delivered, and the company's acceptance of it.
//
// The point is separation of duties. The developer records what was delivered;
// only the owner can accept it; acceptance locks the entry and is stamped with
// who and when. Every status change is appended to work_item_events by a
// database trigger, so the history exists even if a row is edited later. A log
// one party can revise after the fact is a claim, not evidence.

const WORK_STATUSES  = ['delivered', 'accepted', 'rejected', 'invoiced', 'paid'];
const WORK_CATEGORIES = ['feature', 'fix', 'security', 'performance', 'documentation', 'infrastructure', 'other'];

// The owner. `developer` is deliberately excluded — signing off your own
// invoice is exactly what this table exists to prevent.
function ownerOnly(req, res, next) {
  if (req.admin?.role !== 'admin') {
    return res.status(403).json({ error: 'Only the business owner can accept, invoice or mark work as paid.' });
  }
  next();
}

// Either party may read the register and add entries.
function workLogAccess(req, res, next) {
  if (!['admin', 'developer'].includes(req.admin?.role)) {
    return res.status(403).json({ error: 'The work log is visible to the owner and the developer only.' });
  }
  next();
}

function validateWorkItem(b, { isUpdate = false } = {}) {
  const errors = {};
  const title = String(b.title ?? '').trim();

  if (!isUpdate || b.title !== undefined) {
    if (title.length < 4)   errors.title = 'Describe the work in a few words at least.';
    if (title.length > 160) errors.title = 'Keep the title under 160 characters.';
  }
  if (b.category && !WORK_CATEGORIES.includes(b.category)) {
    errors.category = `Category must be one of: ${WORK_CATEGORIES.join(', ')}`;
  }
  if (b.deliveredOn && !/^\d{4}-\d{2}-\d{2}$/.test(b.deliveredOn)) errors.deliveredOn = 'Invalid date.';
  if (b.deliveredOn && b.deliveredOn > new Date().toISOString().split('T')[0]) {
    errors.deliveredOn = 'Work cannot be delivered in the future.';
  }
  if (b.fee !== undefined && b.fee !== null && b.fee !== '') {
    const f = Number(b.fee);
    if (!Number.isFinite(f) || f < 0) errors.fee = 'Enter the agreed fee in KES, or leave it blank.';
    else if (f > 100000000)           errors.fee = 'That figure looks wrong — check for an extra digit.';
  }
  if (b.hours !== undefined && b.hours !== null && b.hours !== '') {
    const h = Number(b.hours);
    if (!Number.isFinite(h) || h < 0 || h > 10000) errors.hours = 'Enter hours as a number.';
  }
  return errors;
}

function toWorkItemDB(b) {
  const row = {};
  if (b.title       !== undefined) row.title    = String(b.title).trim();
  if (b.summary     !== undefined) row.summary  = b.summary?.trim() || null;
  if (b.category    !== undefined) row.category = WORK_CATEGORIES.includes(b.category) ? b.category : 'other';
  if (b.deliveredOn !== undefined) row.delivered_on = b.deliveredOn || new Date().toISOString().split('T')[0];
  if (b.fee         !== undefined) row.fee   = (b.fee === '' || b.fee === null) ? null : Number(b.fee);
  if (b.hours       !== undefined) row.hours = (b.hours === '' || b.hours === null) ? null : Number(b.hours);
  if (b.evidence    !== undefined) row.evidence = b.evidence?.trim() || null;
  if (b.notes       !== undefined) row.notes    = b.notes?.trim() || null;
  // status, locked, accepted_by and the timestamps are never taken from a
  // payload — they are set only by the transition endpoint below.
  return row;
}

app.get('/api/admin/work-log', adminAuth, workLogAccess, async (req, res) => {
  let q = supabase.from('work_items').select('*', { count: 'exact' });
  if (req.query.status && WORK_STATUSES.includes(req.query.status)) q = q.eq('status', req.query.status);
  if (req.query.from) q = q.gte('delivered_on', req.query.from);
  if (req.query.to)   q = q.lte('delivered_on', req.query.to);
  q = q.order('delivered_on', { ascending: false }).order('created_at', { ascending: false });

  const { data, error, count } = await q;
  if (error) return handleError(res, error);

  const items = data.map(map.workItem);
  const sum = (st) => items.filter(i => st.includes(i.status))
                           .reduce((s, i) => s + (Number(i.fee) || 0), 0);

  res.json({
    success: true,
    data: items,
    meta: {
      total: count ?? items.length,
      // What each side cares about: the developer wants to know what is still
      // unpaid; the owner wants to know what is committed but not yet invoiced.
      totals: {
        delivered:   sum(['delivered']),
        accepted:    sum(['accepted']),
        invoiced:    sum(['invoiced']),
        paid:        sum(['paid']),
        outstanding: sum(['accepted', 'invoiced']),
        hours:       items.reduce((s, i) => s + (Number(i.hours) || 0), 0),
      },
      counts: WORK_STATUSES.reduce((a, s) => (a[s] = items.filter(i => i.status === s).length, a), {}),
    },
  });
});

app.get('/api/admin/work-log/:id/history', adminAuth, workLogAccess, async (req, res) => {
  const { data, error } = await supabase.from('work_item_events')
    .select('*').eq('item_id', req.params.id).order('created_at', { ascending: true });
  if (error) return handleError(res, error);
  res.json({
    success: true,
    data: (data || []).map(e => ({
      id: e.id, from: e.from_status, to: e.to_status,
      actor: e.actor, note: e.note, at: e.created_at,
    })),
  });
});

app.post('/api/admin/work-log', adminAuth, workLogAccess, async (req, res) => {
  const errors = validateWorkItem(req.body);
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }
  const row = toWorkItemDB(req.body);
  row.created_by = req.admin?.username || req.admin?.role || null;
  row.status = 'delivered';

  const { data, error } = await supabase.from('work_items').insert(row).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.workItem(data) });
});

app.put('/api/admin/work-log/:id', adminAuth, workLogAccess, async (req, res) => {
  const { data: cur } = await supabase.from('work_items')
    .select('id, locked, status').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Work item not found' });

  // Once the owner has accepted, the description of what they accepted cannot
  // change. Otherwise the signature is against a moving target.
  if (cur.locked) {
    return res.status(409).json({
      error: `This entry was accepted by the owner and is now read-only. Add a new entry instead if further work was done.`,
    });
  }

  const errors = validateWorkItem(req.body, { isUpdate: true });
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }
  const { data, error } = await supabase.from('work_items')
    .update(toWorkItemDB(req.body)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.workItem(data) });
});

// The only route that changes status. Transitions are explicit so the register
// cannot jump straight from delivered to paid without a recorded acceptance.
const WORK_TRANSITIONS = {
  delivered: ['accepted', 'rejected'],
  rejected:  ['delivered'],
  accepted:  ['invoiced'],
  invoiced:  ['paid'],
  paid:      [],
};

app.patch('/api/admin/work-log/:id/status', adminAuth, ownerOnly, async (req, res) => {
  const { status, note, invoiceRef } = req.body;
  if (!WORK_STATUSES.includes(status)) {
    return res.status(400).json({ error: `Status must be one of: ${WORK_STATUSES.join(', ')}` });
  }
  const { data: cur } = await supabase.from('work_items')
    .select('id, status, fee, title').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Work item not found' });

  const allowed = WORK_TRANSITIONS[cur.status] || [];
  if (!allowed.includes(status)) {
    return res.status(409).json({
      error: allowed.length
        ? `A "${cur.status}" entry can only move to: ${allowed.join(' or ')}.`
        : `A "${cur.status}" entry is final and cannot be changed.`,
    });
  }
  if (status === 'rejected' && !String(note || '').trim()) {
    // Rejecting without a reason gives the developer nothing to act on.
    return res.status(400).json({ error: 'Give a reason so the work can be corrected.', fields: { note: 'Required.' } });
  }

  const actor = req.admin?.username || req.admin?.role || null;
  const patch = { status };

  if (status === 'accepted') {
    patch.accepted_by = actor;
    patch.accepted_at = new Date().toISOString();
    patch.locked = true;                 // the signature is against a fixed record
    patch.rejected_reason = null;
  }
  if (status === 'rejected') {
    patch.rejected_reason = String(note).trim();
    patch.locked = false;                // must be editable to be corrected
  }
  if (status === 'delivered') { patch.locked = false; patch.rejected_reason = null; }
  if (status === 'invoiced')  { patch.invoiced_at = new Date().toISOString(); patch.invoice_ref = invoiceRef?.trim() || null; }
  if (status === 'paid')      { patch.paid_at = new Date().toISOString(); }

  const { data, error } = await supabase.from('work_items')
    .update(patch).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.workItem(data) });
});

app.delete('/api/admin/work-log/:id', adminAuth, workLogAccess, async (req, res) => {
  const { data: cur } = await supabase.from('work_items')
    .select('locked, status').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Work item not found' });

  // An accepted entry is part of a financial record. Rejecting is the way to
  // remove something from the total; deleting would erase the trail with it.
  if (cur.locked || cur.status !== 'delivered') {
    return res.status(409).json({
      error: 'Only an entry that has not been accepted can be deleted. This one is part of the agreed record.',
    });
  }
  const { error } = await supabase.from('work_items').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — TRAINING GUIDES ====================
app.get('/api/admin/training', adminAuth, async (req, res) => {
  const role = req.admin?.role;
  let q = supabase.from('training_guides').select('*').order('display_order');
  // Managers see only what is published and aimed at them.
  if (role === 'manager') q = q.eq('is_published', true).in('audience', ['manager', 'both']);

  const { data, error } = await q;
  if (error) return handleError(res, error);
  res.json({ success: true, data: (data || []).map(map.trainingGuide) });
});

app.put('/api/admin/training/:id', adminAuth, adminOnly, async (req, res) => {
  const row = {};
  if (req.body.title    !== undefined) row.title = String(req.body.title).trim();
  if (req.body.intro    !== undefined) row.intro = req.body.intro?.trim() || null;
  if (req.body.icon     !== undefined) row.icon  = req.body.icon?.trim() || 'fa-book';
  if (req.body.audience !== undefined) row.audience = ['manager','admin','both'].includes(req.body.audience) ? req.body.audience : 'manager';
  if (req.body.steps    !== undefined) row.steps = Array.isArray(req.body.steps) ? req.body.steps : [];
  if (req.body.isPublished !== undefined) row.is_published = req.body.isPublished !== false;
  if (req.body.displayOrder !== undefined) row.display_order = Number(req.body.displayOrder) || 0;
  // Stamped on every save: a guide nobody has checked since the screen changed
  // is worse than no guide, so the date has to be visible.
  row.last_reviewed_on = new Date().toISOString().split('T')[0];
  row.updated_by = req.admin?.username || req.admin?.role || null;

  const { data, error } = await supabase.from('training_guides')
    .update(row).eq('id', req.params.id).select().maybeSingle();
  if (error) return handleError(res, error);
  if (!data) return res.status(404).json({ error: 'Guide not found' });
  res.json({ success: true, data: map.trainingGuide(data) });
});

// ==================== ADMIN — DASHBOARD STATS ====================
// ==================== ADMIN — ANALYTICS ====================
//
// One endpoint, one database round trip. The aggregation lives in the
// analytics_summary() SQL function rather than here or in the browser: the old
// tab pulled every booking, review, banner and gallery row into the client and
// summed them there, which is correct at one booking and unbounded at scale.

const ANALYTICS_MAX_DAYS = 730;   // two years; beyond that use an export

// Money is financial data about identifiable clients. Managers run the day to
// day, but revenue, costs and margins are the owner's business — the same line
// already drawn around employees and payroll.
// Strip every figure that describes the company's financial position, leaving
// the operational picture a manager needs to market the business.
//
// Done here rather than by hiding tiles in the dashboard: a manager's token can
// call this endpoint directly, so anything the server sends is disclosed
// whether or not the interface draws it.
//
// Removed: revenue (booked, collected, average deal, outstanding), payroll
// costs, and dataQuality — which counts how many won enquiries still have no
// amount recorded, and is a prompt aimed at the owner.
// Reshaped: byEventType keeps its label and count but loses `value`, the
// revenue each type earned; byMethod goes entirely, being payment totals; the
// daily series keeps enquiries and wins but loses `collected`.
function operationalAnalytics(d) {
  if (!d) return d;
  return {
    period:         d.period,
    enquiries:      d.enquiries,
    reviews:        d.reviews,
    responsiveness: d.responsiveness,
    breakdown: {
      byEventType: (d.breakdown?.byEventType || []).map(r => ({ label: r.label, count: r.count })),
    },
    series: (d.series || []).map(r => ({ day: r.day, enquiries: r.enquiries, won: r.won })),
    // Lets the dashboard render the manager's view without guessing from
    // which keys happen to be absent.
    scope: 'operational',
  };
}

app.get('/api/admin/analytics', adminAuth, async (req, res) => {
  const today = new Date();
  const iso   = (d) => d.toISOString().split('T')[0];

  // Default to the last 30 days including today.
  const defFrom = new Date(today); defFrom.setDate(defFrom.getDate() - 29);

  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : iso(defFrom);
  const to   = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to   || '') ? req.query.to   : iso(today);

  if (from > to) {
    return res.status(400).json({ error: 'The start date must be on or before the end date.' });
  }
  // The function gap-fills one row per day; an unbounded range would build a
  // series with tens of thousands of entries and ship it to a phone.
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (days > ANALYTICS_MAX_DAYS) {
    return res.status(400).json({ error: `Choose a range of ${ANALYTICS_MAX_DAYS} days or fewer.` });
  }

  const { data, error } = await supabase.rpc('analytics_summary', { p_from: from, p_to: to });
  if (error) return handleError(res, error);

  // The owner sees the full picture; everyone else sees the operational subset.
  // Defaulting to the reduced form means a role added later is private by
  // default rather than inheriting the finances by omission.
  const full = req.admin?.role === 'admin';
  res.json({ success: true, data: full ? { ...data, scope: 'full' } : operationalAnalytics(data) });
});

// Record what the client agreed to pay. This is the number every revenue figure
// on the dashboard is built from, so it is deliberately explicit rather than
// inferred from the budget bracket they picked before any quote existed.
app.patch('/api/admin/bookings/:id/amount', adminAuth, adminOnly, async (req, res) => {
  const raw = req.body.agreedAmount;

  // null clears it — a mistyped amount must be removable, not merely editable.
  if (raw === null || raw === '') {
    const { data, error } = await supabase.from('bookings')
      .update({ agreed_amount: null, agreed_at: null, agreed_by: null })
      .eq('id', req.params.id).select().maybeSingle();
    if (error) return handleError(res, error);
    if (!data) return res.status(404).json({ error: 'Enquiry not found' });
    return res.json({ success: true, data: map.booking(data) });
  }

  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: 'Enter the agreed amount in KES, for example 45000.' });
  }
  if (amount > 100000000) {
    return res.status(400).json({ error: 'That amount looks wrong — check for an extra digit.' });
  }

  const { data, error } = await supabase.from('bookings').update({
    agreed_amount: amount,
    agreed_at:     new Date().toISOString(),
    agreed_by:     req.admin?.username || req.admin?.role || null,
  }).eq('id', req.params.id).select().maybeSingle();

  if (error) return handleError(res, error);
  if (!data) return res.status(404).json({ error: 'Enquiry not found' });
  res.json({ success: true, data: map.booking(data) });
});

app.get('/api/admin/bookings/:id/payments', adminAuth, adminOnly, async (req, res) => {
  const { data, error } = await supabase.from('booking_payments')
    .select('*').eq('booking_id', req.params.id).order('paid_on', { ascending: false });
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.payment) });
});

app.post('/api/admin/bookings/:id/payments', adminAuth, adminOnly, async (req, res) => {
  const amount = Number(req.body.amount);
  const errors = {};

  if (!Number.isFinite(amount) || amount <= 0) errors.amount = 'Enter the amount received, for example 15000.';
  if (amount > 100000000)                      errors.amount = 'That amount looks wrong — check for an extra digit.';
  if (req.body.paidOn && !/^\d{4}-\d{2}-\d{2}$/.test(req.body.paidOn)) errors.paidOn = 'Invalid date.';
  if (req.body.paidOn && req.body.paidOn > new Date().toISOString().split('T')[0]) {
    errors.paidOn = 'That date is in the future.';
  }
  const METHODS = ['mpesa', 'cash', 'bank', 'cheque', 'other'];
  if (req.body.method && !METHODS.includes(req.body.method)) {
    errors.method = `Method must be one of: ${METHODS.join(', ')}`;
  }
  if (Object.keys(errors).length) {
    return res.status(400).json({ error: 'Please correct the highlighted fields.', fields: errors });
  }

  const { data: booking } = await supabase.from('bookings')
    .select('id, agreed_amount').eq('id', req.params.id).maybeSingle();
  if (!booking) return res.status(404).json({ error: 'Enquiry not found' });

  const { data, error } = await supabase.from('booking_payments').insert({
    booking_id:  req.params.id,
    amount,
    paid_on:     req.body.paidOn || new Date().toISOString().split('T')[0],
    method:      req.body.method || 'mpesa',
    reference:   req.body.reference?.trim() || null,
    note:        req.body.note?.trim() || null,
    recorded_by: req.admin?.username || req.admin?.role || null,
  }).select().single();

  if (error) {
    // A duplicate M-Pesa code is a double-count in every revenue figure, and an
    // easy slip when reconciling a stack of messages. Name it plainly.
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'That payment reference has already been recorded. Check the payments list before adding it again.',
        fields: { reference: 'Already recorded.' },
      });
    }
    return handleError(res, error);
  }
  res.status(201).json({ success: true, data: map.payment(data) });
});

app.delete('/api/admin/payments/:id', adminAuth, adminOnly, async (req, res) => {
  const { data: cur } = await supabase.from('booking_payments')
    .select('id').eq('id', req.params.id).maybeSingle();
  if (!cur) return res.status(404).json({ error: 'Payment not found' });

  const { error } = await supabase.from('booking_payments').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('dashboard_stats').select('*').single();
  if (error) return handleError(res, error);
  res.json({ success: true, data });
});

// ==================== 404 / ERROR HANDLERS ====================
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });

// Start locally when run directly; export for Vercel
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Lawie Sounds API running on http://localhost:${PORT}`));
}

module.exports = app;
