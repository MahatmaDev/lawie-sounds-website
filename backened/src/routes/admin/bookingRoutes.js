const express = require('express');
const router = express.Router();

const bookings = [
  { id: '1', name: 'John Doe', email: 'john@example.com', phone: '0712345678', eventDate: '2025-06-01', eventType: 'Wedding', status: 'pending' }
];

router.get('/', (req, res) => {
  res.json({ success: true, data: bookings });
});

router.patch('/:id/status', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const booking = bookings.find(b => b.id === id);
  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  booking.status = status;
  res.json({ success: true, data: booking });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const index = bookings.findIndex(b => b.id === id);
  if (index === -1) return res.status(404).json({ error: 'Booking not found' });
  bookings.splice(index, 1);
  res.json({ success: true, message: 'Booking deleted' });
});

router.get('/stats', (req, res) => {
  res.json({ 
    success: true, 
    stats: { 
      total: bookings.length, 
      pending: bookings.filter(b => b.status === 'pending').length,
      confirmed: 0,
      completed: 0,
      cancelled: 0
    } 
  });
});

module.exports = router;