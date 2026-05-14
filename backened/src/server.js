const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' })); // support base64 image uploads

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
  review: (r) => r && ({ id: r.id, clientName: r.client_name, rating: r.rating, comment: r.comment, eventType: r.event_type, isApproved: r.is_approved, createdAt: r.created_at }),
  banner: (r) => r && ({ id: r.id, type: r.type, name: r.name, message: r.message, ctaText: r.cta_text, ctaLink: r.cta_link, isActive: r.is_active, startDate: r.start_date, endDate: r.end_date, priority: r.priority, views: r.views, clicks: r.clicks, ctr: r.ctr, createdAt: r.created_at }),
  booking: (r) => r && ({ id: r.id, name: r.name, email: r.email, phone: r.phone, eventDate: r.event_date, eventType: r.event_type, guestCount: r.guest_count, budget: r.budget, venue: r.venue, services: r.services, status: r.status, notes: r.notes, createdAt: r.created_at }),
  employee: (r) => r && ({ id: r.id, name: r.name, role: r.role, phone: r.phone, email: r.email, hireDate: r.hire_date, status: r.status, totalEvents: r.total_events, avgRating: r.avg_rating, createdAt: r.created_at }),
  payroll: (r) => r && ({ id: r.id, employeeId: r.employee_id, employeeName: r.employee_name, eventName: r.event_name, eventDate: r.event_date, amount: r.amount, status: r.status, paymentDate: r.payment_date, rating: r.rating, createdAt: r.created_at }),
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
  const { data, error } = await supabase.from('bookings').insert({ ...req.body, event_date: req.body.eventDate, event_type: req.body.eventType, guest_count: req.body.guestCount, status: 'pending' }).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.booking(data) });
});

// Submit review (public — requires approval before showing)
app.post('/api/reviews', async (req, res) => {
  const { clientName, rating, comment, eventType } = req.body;
  if (!clientName || !rating) return res.status(400).json({ error: 'Name and rating are required' });
  const { data, error } = await supabase.from('reviews').insert({ client_name: clientName, rating: parseInt(rating), comment, event_type: eventType, is_approved: false }).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data: map.review(data) });
});

// ==================== ADMIN AUTH ====================
app.post('/api/admin/auth/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USERNAME || 'admin';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

  if (username === adminUser && password === adminPass) {
    const session = { id: 1, username: adminUser, name: 'Administrator', role: 'admin', loginTime: Date.now(), expires: Date.now() + 7 * 24 * 60 * 60 * 1000 };
    const token = Buffer.from(JSON.stringify(session)).toString('base64');
    res.json({ success: true, token, user: { id: 1, name: 'Administrator', role: 'admin' } });
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
  res.json({ success: true, data });
});
app.post('/api/admin/posters', adminAuth, async (req, res) => {
  const { title, imageUrl, caption, isActive, startDate, endDate, displayOrder } = req.body;
  const { data, error } = await supabase.from('posters').insert({ title, image_url: imageUrl, caption, is_active: isActive !== false, start_date: startDate || null, end_date: endDate || null, display_order: displayOrder || 0 }).select().single();
  if (error) return handleError(res, error);
  res.status(201).json({ success: true, data });
});
app.put('/api/admin/posters/:id', adminAuth, async (req, res) => {
  const { title, imageUrl, caption, isActive, startDate, endDate, displayOrder } = req.body;
  const { data, error } = await supabase.from('posters').update({ title, image_url: imageUrl, caption, is_active: isActive !== false, start_date: startDate || null, end_date: endDate || null, display_order: displayOrder || 0 }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data });
});
app.patch('/api/admin/posters/:id/toggle', adminAuth, async (req, res) => {
  const { data: cur } = await supabase.from('posters').select('is_active').eq('id', req.params.id).single();
  const { data, error } = await supabase.from('posters').update({ is_active: !cur?.is_active }).eq('id', req.params.id).select().single();
  if (error) return handleError(res, error);
  res.json({ success: true, data });
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

// ==================== 404 / ERROR HANDLERS ====================
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Internal server error' }); });

// Start locally when run directly; export for Vercel
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Lawie Sounds API running on http://localhost:${PORT}`));
}

module.exports = app;
