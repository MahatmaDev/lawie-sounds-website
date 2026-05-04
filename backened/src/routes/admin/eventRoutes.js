const express = require('express');
const router = express.Router();

// Test data
const events = [
  { id: '1', title: 'Afrobeat Night', date: '2025-05-15', venue: 'Club Volume, Nairobi', price: 1500, isActive: true },
  { id: '2', title: 'Corporate Gala', date: '2025-05-20', venue: 'KICC, Nairobi', price: 5000, isActive: true }
];

router.get('/', (req, res) => {
  res.json({ success: true, data: events });
});

router.post('/', (req, res) => {
  const newEvent = { id: Date.now().toString(), ...req.body, isActive: true };
  events.push(newEvent);
  res.status(201).json({ success: true, data: newEvent });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const index = events.findIndex(e => e.id === id);
  if (index === -1) return res.status(404).json({ error: 'Event not found' });
  events[index] = { ...events[index], ...req.body };
  res.json({ success: true, data: events[index] });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const index = events.findIndex(e => e.id === id);
  if (index === -1) return res.status(404).json({ error: 'Event not found' });
  events.splice(index, 1);
  res.json({ success: true, message: 'Event deleted' });
});

module.exports = router;