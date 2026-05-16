const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const app = express();

// Security headers
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));

// HTTP request logging
app.use(morgan('combined'));

// CORS — allow Vercel domain + localhost dev
const allowedOrigins = [
  'https://lawie-sounds-website.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500'
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '20mb' })); // support base64 image uploads

// Rate limiting — 100 req/15min general, 10 req/15min on login
const generalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many login attempts. Try again in 15 minutes.' }, standardHeaders: true, legacyHeaders: false });
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
    const decoded = JSON.parse(Buffer.from(auth.split(' ')[1], 'base64').toString());
    const expiry = decoded.expires || decoded.exp;
    if (!expiry || expiry < Date.now()) return res.status(401).json({ error: 'Session expired' });
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ==================== MAPPING (DB snake_case → API camelCase) ====================
const map = {
  event: (r) => r && ({ id: r.id, title: r.title, date: r.date, venue: r.venue, price: r.price, totalSeats: r.total_seats, seatsLeft: r.seats_left, description: r.description, image: r.image, status: r.status, isActive: r.is_active, bookingCount: r.booking_count, createdAt: r.created_at }),
  service: (r) => r && ({ id: r.id, name: r.name, slug: r.slug, category: r.category, icon: r.icon, shortDesc: r.short_desc, longDesc: r.long_desc, mainImage: r.image, isActive: r.is_active, displayOrder: r.display_order, packages: r.packages || [], features: r.features || [], faqs: r.faqs || [], createdAt: r.created_at }),
  gallery: (r) => r && ({ id: r.id, title: r.title, category: r.category, type: r.type, imageUrl: r.image_url, createdAt: r.created_at }),
  review: (r) => r && ({ id: r.id, clientName: r.client_name, rating: r.rating, comment: r.comment, eventType: r.event_type, eventDate: r.event_date, serviceId: r.service_id, clientImage: r.client_image, isApproved: r.is_approved, isFeatured: r.is_featured, adminReply: r.admin_reply, createdAt: r.created_at }),
  banner: (r) => r && ({ id: r.id, type: r.type, name: r.name, message: r.message, ctaText: r.cta_text, ctaLink: r.cta_link, isActive: r.is_active, startDate: r.start_date, endDate: r.end_date, priority: r.priority, views: r.views, clicks: r.clicks, ctr: r.ctr, createdAt: r.created_at }),
  booking: (r) => r && ({ id: r.id, bookingReference: r.booking_reference, name: r.name, email: r.email, phone: r.phone, eventDate: r.event_date, eventType: r.event_type, eventId: r.event_id, guestCount: r.guest_count, budget: r.budget, venue: r.venue, services: r.services, selectedPackage: r.selected_package, ticketQuantity: r.ticket_quantity, totalAmount: r.total_amount, status: r.status, notes: r.notes, createdAt: r.created_at }),
  employee: (r) => r && ({ id: r.id, name: r.name, role: r.role, phone: r.phone, email: r.email, hireDate: r.hire_date, status: r.status, totalEvents: r.total_events, avgRating: r.avg_rating, createdAt: r.created_at }),
  payroll: (r) => r && ({ id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, eventName: r.event_name, eventDate: r.event_date, amount: r.amount, status: r.status, paymentDate: r.payment_date, rating: r.rating, createdAt: r.created_at }),
  poster: (r) => r && ({ id: r.id, title: r.title, imageUrl: r.image_url, caption: r.caption, isActive: r.is_active, startDate: r.start_date, endDate: r.end_date, displayOrder: r.display_order, createdAt: r.created_at }),
  notification: (r) => r && ({ id: r.id, type: r.type, title: r.title, message: r.message, isRead: r.is_read, referenceId: r.reference_id, referenceTable: r.reference_table, createdAt: r.created_at }),
  setting: (r) => r && ({ id: r.id, key: r.key, value: r.value, description: r.description, updatedAt: r.updated_at }),
};

// ==================== DB CONVERTERS (API camelCase → DB snake_case) ====================
function toEventDB(b) {
  return { title: b.title, date: b.date, venue: b.venue, price: b.price || 0, total_seats: b.totalSeats, seats_left: b.seatsLeft !== undefined ? b.seatsLeft : b.totalSeats, description: b.description, image: b.image, status: b.status || 'published', is_active: b.isActive !== false, booking_count: b.bookingCount || 0 };
}
function toServiceDB(b) {
  return { name: b.name, slug: b.slug || b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), category: b.category, icon: b.icon, short_desc: b.shortDesc, long_desc: b.longDesc, image: b.mainImage || b.image, is_active: b.isActive !== false, display_order: b.displayOrder || 0, packages: b.packages || [], features: b.features || [], faqs: b.faqs || [] };
}
function toBannerDB(b) {
  return { type: b.type || 'banner', name: b.name, message: b.message, cta_text: b.ctaText, cta_link: b.ctaLink, is_active: b.isActive !== false, start_date: b.startDate || null, end_date: b.endDate || null, priority: b.priority || 0, views: 0, clicks: 0, ctr: 0 };
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

// WhatsApp push notification via CallMeBot (free — admin must activate once)
// Setup: WhatsApp +34 644 38 11 72, send: "I allow callmebot to send me messages"
// Then add ADMIN_PHONE and CALLMEBOT_APIKEY to Vercel env vars
async function notifyAdmin(message) {
  const phone = process.env.ADMIN_PHONE;
  const apiKey = process.env.CALLMEBOT_APIKEY;
  if (!phone || !apiKey) return;
  try {
    fetch(`https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodeURIComponent(message)}&apikey=${apiKey}`);
  } catch (e) {}
}

// Create an in-app notification record (fire-and-forget)
async function createNotification(type, title, message, referenceId, referenceTable) {
  try {
    await supabase.from('notifications').insert({ type, title, message, reference_id: referenceId || null, reference_table: referenceTable || null });
  } catch (e) {}
}

// ==================== PUBLIC ROUTES ====================

app.get('/health', (_, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Services (active only — no prices in response for public)
app.get('/api/services', async (req, res) => {
  const { data, error } = await supabase.from('services').select('id,name,slug,category,icon,short_desc,image,is_active,display_order,features,faqs').eq('is_active', true).order('display_order');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.service) });
});

// Events (upcoming active)
app.get('/api/events', async (req, res) => {
  const { data, error } = await supabase.from('events').select('*').eq('is_active', true).order('date');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.event) });
});

// Gallery (all items)
app.get('/api/gallery', async (req, res) => {
  const { data, error } = await supabase.from('gallery').select('*').order('created_at', { ascending: false });
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

// Submit booking (public)
app.post('/api/bookings', async (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  const ua = req.headers['user-agent'] || '';
  const dbRow = {
    name, phone,
    email:            req.body.email           || null,
    event_date:       req.body.eventDate        || null,
    event_type:       req.body.eventType        || null,
    event_id:         req.body.eventId          || null,
    guest_count:      req.body.guestCount       || null,
    budget:           req.body.budget           || null,
    venue:            req.body.venue            || null,
    services:         req.body.services         || null,
    selected_package: req.body.selectedPackage  || null,
    ticket_quantity:  req.body.ticketQuantity   || 1,
    total_amount:     req.body.totalAmount      || null,
    notes:            req.body.notes            || null,
    status:           'pending',
    user_ip:          ip,
    user_agent:       ua,
  };
  const { data, error } = await supabase.from('bookings').insert(dbRow).select().single();
  if (error) return handleError(res, error);
  const ref = data.booking_reference || data.id;
  notifyAdmin(`🎉 NEW BOOKING REQUEST!\n\nRef: ${ref}\nClient: ${name}\nPhone: ${phone}\nEvent: ${req.body.eventType || 'N/A'} on ${req.body.eventDate || 'TBD'}\nVenue: ${req.body.venue || 'N/A'}\nBudget: KES ${req.body.budget || 'N/A'}\nServices: ${req.body.services || 'N/A'}\n\n👉 Dashboard: https://lawie-sounds-website.vercel.app/admin/dashboard.html`);
  createNotification('booking', 'New Booking Request', `${name} (${phone}) — ${req.body.eventType || 'Event'} on ${req.body.eventDate || 'TBD'}`, data.id, 'bookings');
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
    const session = { id: role === 'admin' ? 1 : 2, username, name, role, loginTime: Date.now(), expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    const token   = Buffer.from(JSON.stringify(session)).toString('base64');
    res.json({ success: true, token, user: { id: session.id, name, role } });
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
  const { data, error } = await supabase.from('events').update(toEventDB(req.body)).eq('id', req.params.id).select().single();
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
  const { title, category, type, imageUrl } = req.body;
  const { data, error } = await supabase.from('gallery').insert({ title, category, type, image_url: imageUrl }).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.gallery(data) });
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
app.patch('/api/admin/bookings/:id/status', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('bookings').update({ status: req.body.status }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.booking(data) });
});

// ==================== ADMIN — EMPLOYEES ====================
app.get('/api/admin/employees', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('employees').select('*').order('name');
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.employee) });
});
app.post('/api/admin/employees', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('employees').insert(toEmployeeDB(req.body)).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.employee(data) });
});
app.put('/api/admin/employees/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('employees').update(toEmployeeDB(req.body)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data: map.employee(data) });
});
app.delete('/api/admin/employees/:id', adminAuth, async (req, res) => {
  await supabase.from('payroll').delete().eq('employee_id', req.params.id);
  const { error } = await supabase.from('employees').delete().eq('id', req.params.id);
  if (error) return handleError(res, error);
  res.json({ success: true });
});

// ==================== ADMIN — PAYROLL ====================
app.get('/api/admin/payroll', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('payroll').select('*').order('created_at', { ascending: false });
  if (error) return handleError(res, error);
  res.json({ success: true, data: data.map(map.payroll) });
});
app.post('/api/admin/payroll', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('payroll').insert(toPayrollDB(req.body)).select().single();
  if (error) return handleError(res, error);
  await syncEmployeeStats(req.body.employeeId);
  res.status(201).json({ success: true, data: map.payroll(data) });
});
app.put('/api/admin/payroll/:id', adminAuth, async (req, res) => {
  const { data, error } = await supabase.from('payroll').update(toPayrollDB(req.body)).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  await syncEmployeeStats(req.body.employeeId);
  res.json({ success: true, data: map.payroll(data) });
});
app.delete('/api/admin/payroll/:id', adminAuth, async (req, res) => {
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
