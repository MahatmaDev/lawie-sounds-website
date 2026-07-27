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

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / same-origin
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
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
  service: (r) => r && ({ id: r.id, name: r.name, slug: r.slug, category: r.category, icon: r.icon, shortDesc: r.short_desc, longDesc: r.long_desc, mainImage: r.image, isActive: r.is_active, displayOrder: r.display_order, packages: r.packages || [], features: r.features || [], faqs: r.faqs || [], createdAt: r.created_at }),
  gallery: (r) => r && ({ id: r.id, title: r.title, category: r.category, type: r.type, imageUrl: r.image_url, serviceSlug: r.service_slug, isFeatured: r.is_featured, displayOrder: r.display_order, createdAt: r.created_at }),
  review: (r) => r && ({ id: r.id, clientName: r.client_name, rating: r.rating, comment: r.comment, eventType: r.event_type, eventDate: r.event_date, serviceId: r.service_id, clientImage: r.client_image, isApproved: r.is_approved, isFeatured: r.is_featured, adminReply: r.admin_reply, createdAt: r.created_at }),
  banner: (r) => r && ({ id: r.id, type: r.type, name: r.name, message: r.message, ctaText: r.cta_text, ctaLink: r.cta_link, isActive: r.is_active, startDate: r.start_date, endDate: r.end_date, priority: r.priority, views: r.views, clicks: r.clicks, ctr: r.ctr, createdAt: r.created_at }),
  booking: (r) => r && ({ id: r.id, bookingReference: r.booking_reference, name: r.name, email: r.email, phone: r.phone, eventDate: r.event_date, eventType: r.event_type, eventId: r.event_id, guestCount: r.guest_count, budget: r.budget, venue: r.venue, services: r.services, selectedPackage: r.selected_package, ticketQuantity: r.ticket_quantity, totalAmount: r.total_amount, status: r.status, notes: r.notes, specialRequests: r.event_details, source: r.source, channel: r.channel, respondedAt: r.responded_at, handledBy: r.handled_by, createdAt: r.created_at }),
  employee: (r) => r && ({ id: r.id, name: r.name, role: r.role, phone: r.phone, email: r.email, hireDate: r.hire_date, status: r.status, totalEvents: r.total_events, avgRating: r.avg_rating, createdAt: r.created_at }),
  payroll: (r) => r && ({ id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, eventName: r.event_name, eventDate: r.event_date, amount: r.amount, status: r.status, paymentDate: r.payment_date, rating: r.rating, createdAt: r.created_at }),
  poster: (r) => r && ({ id: r.id, title: r.title, imageUrl: r.image_url, caption: r.caption, isActive: r.is_active, startDate: r.start_date, endDate: r.end_date, displayOrder: r.display_order, createdAt: r.created_at }),
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
  return { name: b.name, slug: b.slug || b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), category: b.category, icon: b.icon, short_desc: b.shortDesc, long_desc: b.longDesc, image: b.mainImage || b.image, is_active: b.isActive !== false, display_order: b.displayOrder || 0, packages: b.packages || [], features: b.features || [], faqs: b.faqs || [] };
}
function toGalleryDB(b) {
  return { title: b.title, category: b.category, type: b.type || 'image', image_url: b.imageUrl, service_slug: b.serviceSlug || null, is_featured: b.isFeatured || false, display_order: b.displayOrder || 0 };
}
// Same pattern as toEventDB: views/clicks/ctr are accumulated by the site, not
// supplied by the edit form. Sending them on UPDATE wiped a banner's entire
// performance history every time someone fixed a typo.
function toBannerDB(b, isUpdate = false) {
  const row = { type: b.type || 'banner', name: b.name, message: b.message, cta_text: b.ctaText, cta_link: b.ctaLink, is_active: b.isActive !== false, start_date: b.startDate || null, end_date: b.endDate || null, priority: b.priority || 0 };
  if (!isUpdate) { row.views = 0; row.clicks = 0; row.ctr = 0; }
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
  res.json({ success: true, data: data.map(map.service) });
});

// Single service by slug or UUID (for service-detail.html)
app.get('/api/services/:slug', async (req, res) => {
  const { slug } = req.params;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
  const { data, error } = await supabase.from('services').select('*')
    .eq(isUuid ? 'id' : 'slug', slug).eq('is_active', true).single();
  if (error || !data) return res.status(404).json({ error: 'Service not found' });
  // Also fetch approved reviews for this service
  const { data: reviews } = await supabase.from('reviews').select('client_name,rating,comment,event_type,event_date').eq('is_approved', true).eq('service_id', data.id).order('created_at', { ascending: false }).limit(6);
  // Fetch gallery images linked to this service (by service_slug field if set, else by slug match)
  const { data: gallery } = await supabase.from('gallery').select('id,title,category,type,image_url').eq('service_slug', data.slug).order('created_at', { ascending: false }).limit(12);
  res.json({ success: true, data: { ...map.service(data), reviews: (reviews || []).map(map.review), gallery: (gallery || []).map(map.gallery) } });
});

// Events (upcoming active)
app.get('/api/events', async (req, res) => {
  const { data, error } = await supabase.from('events').select('*').eq('is_active', true).order('date');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.event) });
});

// Gallery — supports ?featured=true, ?category=X, ?service=slug
app.get('/api/gallery', async (req, res) => {
  let q = supabase.from('gallery').select('*');
  if (req.query.featured === 'true')   q = q.eq('is_featured', true);
  if (req.query.category)              q = q.eq('category', req.query.category);
  if (req.query.service)               q = q.eq('service_slug', req.query.service);
  // Featured items first (nulls last), then by display_order, then newest
  q = q.order('is_featured', { ascending: false, nullsFirst: false })
       .order('display_order', { ascending: true })
       .order('created_at', { ascending: false });
  const { data, error } = await q;
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.gallery) });
});

// Reviews (approved only)
app.get('/api/reviews', async (req, res) => {
  const { data, error } = await supabase.from('reviews').select('*').eq('is_approved', true).order('created_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.review) });
});

// Marketing banners (active, within date range)
app.get('/api/banners', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.from('marketing_banners').select('*').eq('is_active', true).order('priority', { ascending: false });
  if (error) return handleError(res, error);
  const active = data.filter(b => (!b.start_date || b.start_date <= today) && (!b.end_date || b.end_date >= today));
  res.json({ success: true, data: active.map(map.banner) });
});

// Posters (active, within date range)
app.get('/api/posters', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.from('posters').select('*').eq('is_active', true).order('display_order');
  if (error) return handleError(res, error);
  const active = data.filter(p => (!p.start_date || p.start_date <= today) && (!p.end_date || p.end_date >= today));
  res.json({ success: true, data: active });
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

  const ref = data.booking_reference || data.id;
  const serviceList = (row.services || []).join(', ') || 'N/A';

  // await both: on Vercel serverless the function can freeze the moment the
  // response is sent, cancelling any in-flight promise that was not awaited.
  await Promise.allSettled([
    notifyAdmin(`🎉 NEW ENQUIRY!\n\nRef: ${ref}\nClient: ${name}\nPhone: ${normalisedPhone}\nEvent: ${row.event_type || 'N/A'} on ${row.event_date || 'TBD'}\nVenue: ${row.venue || 'N/A'}\nBudget: KES ${row.budget || 'N/A'}\nServices: ${serviceList}\n\n👉 Dashboard: ${process.env.FRONTEND_URL || ''}/admin/dashboard.html?tab=bookings`),
    createNotification('booking', 'New Enquiry', `${name} (${normalisedPhone}) — ${row.event_type || 'Event'} on ${row.event_date || 'TBD'}`, data.id, 'bookings'),
  ]);

  res.status(201).json({ success: true, data: map.booking(data) });
});

// Submit review (public — requires approval before showing)
app.post('/api/reviews', async (req, res) => {
  const { clientName, rating, comment, eventType, eventDate, serviceId, clientImage } = req.body;
  if (!clientName || !rating) return res.status(400).json({ error: 'Name and rating are required' });
  const { data, error } = await supabase.from('reviews').insert({
    client_name:  clientName,
    rating:       parseInt(rating),
    comment,
    event_type:   eventType   || null,
    event_date:   eventDate   || null,
    service_id:   serviceId   || null,
    client_image: clientImage || null,
    is_approved:  false,
    is_featured:  false,
  }).select().single();
  if (error) return handleError(res, error);
  notifyAdmin(`⭐ NEW REVIEW — Needs Approval!\n\nFrom: ${clientName}\nRating: ${'⭐'.repeat(parseInt(rating))} (${rating}/5)\nEvent: ${eventType || 'N/A'}\nComment: "${(comment || '').slice(0, 120)}"\n\n👉 Approve at: https://lawie-sounds-website.vercel.app/admin/dashboard.html`);
  createNotification('review', 'New Review Submitted', `${clientName} left a ${rating}-star review — pending approval`, data.id, 'reviews');
  res.status(201).json({ success: true, data: map.review(data) });
});

// ==================== ADMIN AUTH ====================
app.post('/api/admin/auth/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser   = process.env.ADMIN_USERNAME   || 'admin';
  const adminPass   = process.env.ADMIN_PASSWORD   || 'admin123';
  const managerUser = process.env.MANAGER_USERNAME;
  const managerPass = process.env.MANAGER_PASSWORD;

  let role = null;
  if (username === adminUser && password === adminPass) role = 'admin';
  else if (managerUser && managerPass && username === managerUser && password === managerPass) role = 'manager';

  if (role) {
    const name    = role === 'admin' ? 'Administrator' : 'Website Manager';
    const payload = { id: role === 'admin' ? 1 : 2, username, name, role, loginTime: Date.now() };
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
  const { error } = await supabase.from('services').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — GALLERY ====================
app.get('/api/admin/gallery', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('gallery').select('*').order('created_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.gallery) });
});
app.post('/api/admin/gallery', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('gallery').insert(toGalleryDB(req.body)).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.gallery(data) });
});
app.put('/api/admin/gallery/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('gallery').update(toGalleryDB(req.body)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  if (!data) return res.status(404).json({ error: 'Gallery item not found' });
  res.json({ success: true, data: map.gallery(data) });
});
app.patch('/api/admin/gallery/:id/feature', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('gallery').select('is_featured').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('gallery').update({ is_featured: !cur?.is_featured }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.gallery(data) });
});
app.delete('/api/admin/gallery/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('gallery').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — REVIEWS ====================
app.get('/api/admin/reviews', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('reviews').select('*').order('created_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.review) });
});
app.patch('/api/admin/reviews/:id/approve', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('reviews').update({ is_approved: true }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.review(data) });
});
app.patch('/api/admin/reviews/:id/reply', adminAuth, async (req, res) => {
  const { reply } = req.body;
  if (!reply) return res.status(400).json({ error: 'Reply text is required' });
  const { data, error } = await supabase.from('reviews').update({ admin_reply: reply }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.review(data) });
});
app.patch('/api/admin/reviews/:id/feature', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('reviews').select('is_featured').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('reviews').update({ is_featured: !cur?.is_featured }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.review(data) });
});
app.delete('/api/admin/reviews/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('reviews').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — MARKETING BANNERS ====================
app.get('/api/admin/banners', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('marketing_banners').select('*').order('created_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.banner) });
});
app.post('/api/admin/banners', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('marketing_banners').insert(toBannerDB(req.body)).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.banner(data) });
});
app.put('/api/admin/banners/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('marketing_banners').update(toBannerDB(req.body, true)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.banner(data) });
});
app.patch('/api/admin/banners/:id/toggle', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('marketing_banners').select('is_active').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('marketing_banners').update({ is_active: !cur?.is_active }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.banner(data) });
});
app.delete('/api/admin/banners/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('marketing_banners').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — POSTERS ====================
app.get('/api/admin/posters', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('posters').select('*').order('display_order');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.poster) });
});
app.post('/api/admin/posters', adminAuth, async (req, res) => {
  const { title, imageUrl, caption, isActive, startDate, endDate, displayOrder } = req.body;
  const { data, error } = await supabase.from('posters').insert({ title, image_url: imageUrl, caption, is_active: isActive !== false, start_date: startDate || null, end_date: endDate || null, display_order: displayOrder || 0 }).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.poster(data) });
});
app.put('/api/admin/posters/:id', adminAuth, async (req, res) => {
  const { title, imageUrl, caption, isActive, startDate, endDate, displayOrder } = req.body;
  const { data, error } = await supabase.from('posters').update({ title, image_url: imageUrl, caption, is_active: isActive !== false, start_date: startDate || null, end_date: endDate || null, display_order: displayOrder || 0 }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.poster(data) });
});
app.patch('/api/admin/posters/:id/toggle', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('posters').select('is_active').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('posters').update({ is_active: !cur?.is_active }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.poster(data) });
});
app.delete('/api/admin/posters/:id', adminAuth, async (req, res) => {
  const { error } = await supabase.from('posters').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
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

// ==================== ADMIN — DASHBOARD STATS ====================
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
