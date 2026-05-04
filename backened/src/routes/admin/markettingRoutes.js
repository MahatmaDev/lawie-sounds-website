const express = require('express');
const router = express.Router();

const banners = [
  { id: '1', message: '🎉 Special Offer: 15% off!', ctaText: 'Claim Offer', ctaLink: '/booking.html', isActive: true }
];

router.get('/', (req, res) => {
  res.json({ success: true, data: banners });
});

router.post('/', (req, res) => {
  const newBanner = { id: Date.now().toString(), ...req.body, isActive: true };
  banners.push(newBanner);
  res.status(201).json({ success: true, data: newBanner });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const index = banners.findIndex(b => b.id === id);
  if (index === -1) return res.status(404).json({ error: 'Banner not found' });
  banners[index] = { ...banners[index], ...req.body };
  res.json({ success: true, data: banners[index] });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const index = banners.findIndex(b => b.id === id);
  if (index === -1) return res.status(404).json({ error: 'Banner not found' });
  banners.splice(index, 1);
  res.json({ success: true, message: 'Banner deleted' });
});

router.patch('/:id/toggle', (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;
  const index = banners.findIndex(b => b.id === id);
  if (index === -1) return res.status(404).json({ error: 'Banner not found' });
  banners[index].isActive = isActive;
  res.json({ success: true, data: banners[index] });
});

module.exports = router;