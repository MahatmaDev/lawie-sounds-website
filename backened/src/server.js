const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Lawie Sounds API is running', timestamp: new Date().toISOString() });
});

// ==================== TEST ROUTE ====================
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

// ==================== ADMIN AUTH ROUTES ====================
app.post('/api/admin/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  if (username === 'admin' && password === 'admin123') {
    const token = Buffer.from(JSON.stringify({ 
      id: 1, 
      username: 'admin', 
      role: 'admin',
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    })).toString('base64');
    
    res.json({ 
      success: true, 
      token,
      user: { id: 1, username: 'admin', role: 'admin' }
    });
  } else if (username === 'manager' && password === 'manager123') {
    const token = Buffer.from(JSON.stringify({ 
      id: 2, 
      username: 'manager', 
      role: 'manager',
      exp: Date.now() + 7 * 24 * 60 * 60 * 1000
    })).toString('base64');
    
    res.json({ 
      success: true, 
      token,
      user: { id: 2, username: 'manager', role: 'manager' }
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.get('/api/admin/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
    if (decoded.exp < Date.now()) {
      return res.status(401).json({ error: 'Token expired' });
    }
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ==================== EVENTS ROUTES ====================
let events = [
  { id: '1', title: 'Afrobeat Night', date: '2025-05-15', venue: 'Club Volume, Nairobi', price: 1500, seatsLeft: 45, isActive: true },
  { id: '2', title: 'Corporate Gala', date: '2025-05-20', venue: 'KICC, Nairobi', price: 5000, seatsLeft: 120, isActive: true },
  { id: '3', title: 'Wedding Expo', date: '2025-06-10', venue: 'Sarit Centre', price: 2000, seatsLeft: 200, isActive: true }
];

app.get('/api/admin/events', (req, res) => {
  res.json({ success: true, data: events });
});

app.post('/api/admin/events', (req, res) => {
  const newEvent = { id: Date.now().toString(), ...req.body, isActive: true };
  events.push(newEvent);
  res.status(201).json({ success: true, data: newEvent });
});

app.put('/api/admin/events/:id', (req, res) => {
  const { id } = req.params;
  const index = events.findIndex(e => e.id === id);
  if (index === -1) return res.status(404).json({ error: 'Event not found' });
  events[index] = { ...events[index], ...req.body };
  res.json({ success: true, data: events[index] });
});

app.delete('/api/admin/events/:id', (req, res) => {
  const { id } = req.params;
  const index = events.findIndex(e => e.id === id);
  if (index === -1) return res.status(404).json({ error: 'Event not found' });
  events.splice(index, 1);
  res.json({ success: true, message: 'Event deleted' });
});

// ==================== GALLERY ROUTES ====================
let gallery = [
  { id: '1', title: 'DJ Performance', category: 'Audio', imageUrl: 'https://images.unsplash.com/photo-1593642532973-d31b6557fa68', createdAt: new Date().toISOString() },
  { id: '2', title: 'Wedding Setup', category: 'Weddings', imageUrl: 'https://images.unsplash.com/photo-1519741497674-611481863552', createdAt: new Date().toISOString() }
];

app.get('/api/admin/gallery', (req, res) => {
  res.json({ success: true, data: gallery });
});

app.post('/api/admin/gallery', (req, res) => {
  const newImage = { id: Date.now().toString(), ...req.body, createdAt: new Date().toISOString() };
  gallery.push(newImage);
  res.status(201).json({ success: true, data: newImage });
});

app.delete('/api/admin/gallery/:id', (req, res) => {
  const { id } = req.params;
  const index = gallery.findIndex(i => i.id === id);
  if (index === -1) return res.status(404).json({ error: 'Image not found' });
  gallery.splice(index, 1);
  res.json({ success: true, message: 'Image deleted' });
});

// ==================== REVIEWS ROUTES ====================
let reviews = [
  { id: '1', clientName: 'Sarah & James', rating: 5, comment: 'Amazing service! Highly recommend.', eventType: 'Wedding', isApproved: true, createdAt: new Date().toISOString() },
  { id: '2', clientName: 'Tech Corp', rating: 5, comment: 'Professional and reliable team.', eventType: 'Corporate', isApproved: false, createdAt: new Date().toISOString() }
];

app.get('/api/admin/reviews', (req, res) => {
  res.json({ success: true, data: reviews });
});

app.put('/api/admin/reviews/:id/approve', (req, res) => {
  const { id } = req.params;
  const review = reviews.find(r => r.id === id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  review.isApproved = true;
  res.json({ success: true, data: review });
});

app.delete('/api/admin/reviews/:id', (req, res) => {
  const { id } = req.params;
  const index = reviews.findIndex(r => r.id === id);
  if (index === -1) return res.status(404).json({ error: 'Review not found' });
  reviews.splice(index, 1);
  res.json({ success: true, message: 'Review deleted' });
});

// ==================== MARKETING ROUTES ====================
let marketingBanners = [
  { id: '1', type: 'banner', message: '🎉 Special Offer: 15% off April bookings!', ctaText: 'Claim Offer', ctaLink: '/booking.html', isActive: true, startDate: '2025-04-01', endDate: '2025-04-30' }
];

app.get('/api/admin/marketing', (req, res) => {
  res.json({ success: true, data: marketingBanners });
});

app.post('/api/admin/marketing', (req, res) => {
  const newBanner = { id: Date.now().toString(), ...req.body, isActive: true };
  marketingBanners.push(newBanner);
  res.status(201).json({ success: true, data: newBanner });
});

app.put('/api/admin/marketing/:id', (req, res) => {
  const { id } = req.params;
  const index = marketingBanners.findIndex(b => b.id === id);
  if (index === -1) return res.status(404).json({ error: 'Banner not found' });
  marketingBanners[index] = { ...marketingBanners[index], ...req.body };
  res.json({ success: true, data: marketingBanners[index] });
});

app.delete('/api/admin/marketing/:id', (req, res) => {
  const { id } = req.params;
  const index = marketingBanners.findIndex(b => b.id === id);
  if (index === -1) return res.status(404).json({ error: 'Banner not found' });
  marketingBanners.splice(index, 1);
  res.json({ success: true, message: 'Banner deleted' });
});

app.patch('/api/admin/marketing/:id/toggle', (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;
  const index = marketingBanners.findIndex(b => b.id === id);
  if (index === -1) return res.status(404).json({ error: 'Banner not found' });
  marketingBanners[index].isActive = isActive;
  res.json({ success: true, data: marketingBanners[index] });
});

// ==================== BOOKINGS ROUTES ====================
let bookings = [
  { id: '1', name: 'John Doe', email: 'john@example.com', phone: '0712345678', eventDate: '2025-06-01', eventType: 'Wedding', guestCount: '101-250', budget: '100k-200k', venue: 'Nairobi', status: 'pending', createdAt: new Date().toISOString() },
  { id: '2', name: 'Jane Smith', email: 'jane@example.com', phone: '0723456789', eventDate: '2025-05-25', eventType: 'Corporate', guestCount: '51-100', budget: '50k-100k', venue: 'Westlands', status: 'confirmed', createdAt: new Date().toISOString() }
];

app.get('/api/admin/bookings', (req, res) => {
  res.json({ success: true, data: bookings });
});

app.patch('/api/admin/bookings/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const booking = bookings.find(b => b.id === id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  booking.status = status;
  res.json({ success: true, data: booking });
});

app.delete('/api/admin/bookings/:id', (req, res) => {
  const { id } = req.params;
  const index = bookings.findIndex(b => b.id === id);
  if (index === -1) return res.status(404).json({ error: 'Booking not found' });
  bookings.splice(index, 1);
  res.json({ success: true, message: 'Booking deleted' });
});

app.get('/api/admin/bookings/stats', (req, res) => {
  res.json({ 
    success: true, 
    stats: { 
      total: bookings.length, 
      pending: bookings.filter(b => b.status === 'pending').length,
      confirmed: bookings.filter(b => b.status === 'confirmed').length,
      completed: bookings.filter(b => b.status === 'completed').length,
      cancelled: bookings.filter(b => b.status === 'cancelled').length
    } 
  });
});

// ==================== SERVICES ROUTES ====================
let services = [
  { id: '1', name: 'DJ & MC Services', slug: 'dj-mc-services', category: 'Audio', icon: 'fa-headphones', price: 25000, shortDesc: 'Professional DJ and MC for high-energy events.', image: 'IMAGES/DJ%20and%20MC%20Services/1.jpg', isActive: true, displayOrder: 1 },
  { id: '2', name: 'LED Screens', slug: 'led-screens', category: 'Visual', icon: 'fa-tv', price: 15000, shortDesc: 'High-resolution LED screens for stunning visuals.', image: 'IMAGES/LED%20Screens/1.jpg', isActive: true, displayOrder: 2 },
  { id: '3', name: 'Power & Lighting', slug: 'power-lighting', category: 'Lighting', icon: 'fa-lightbulb', price: 18000, shortDesc: 'Professional lighting design and power distribution.', image: 'IMAGES/Power%20&%20Lighting/1.jpg', isActive: true, displayOrder: 3 }
];

app.get('/api/admin/services', (req, res) => {
  res.json({ success: true, data: services });
});

app.get('/api/admin/services/:id', (req, res) => {
  const { id } = req.params;
  const service = services.find(s => s.id === id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  res.json({ success: true, data: service });
});

app.post('/api/admin/services', (req, res) => {
  const newService = { id: Date.now().toString(), ...req.body, isActive: true };
  services.push(newService);
  res.status(201).json({ success: true, data: newService });
});

app.put('/api/admin/services/:id', (req, res) => {
  const { id } = req.params;
  const index = services.findIndex(s => s.id === id);
  if (index === -1) return res.status(404).json({ error: 'Service not found' });
  services[index] = { ...services[index], ...req.body };
  res.json({ success: true, data: services[index] });
});

app.delete('/api/admin/services/:id', (req, res) => {
  const { id } = req.params;
  const index = services.findIndex(s => s.id === id);
  if (index === -1) return res.status(404).json({ error: 'Service not found' });
  services.splice(index, 1);
  res.json({ success: true, message: 'Service deleted' });
});

// ==================== 404 HANDLER ====================
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Test API: http://localhost:${PORT}/api/test`);
  console.log(`🔐 Admin login: POST http://localhost:${PORT}/api/admin/auth/login`);
});