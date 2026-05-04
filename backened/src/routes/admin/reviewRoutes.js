const express = require('express');
const router = express.Router();

const reviews = [
  { id: '1', clientName: 'Sarah & James', rating: 5, comment: 'Amazing service!', isApproved: true },
  { id: '2', clientName: 'Tech Corp', rating: 5, comment: 'Professional team!', isApproved: false }
];

router.get('/', (req, res) => {
  res.json({ success: true, data: reviews });
});

router.put('/:id/approve', (req, res) => {
  const { id } = req.params;
  const review = reviews.find(r => r.id === id);
  if (!review) return res.status(404).json({ error: 'Review not found' });
  review.isApproved = true;
  res.json({ success: true, data: review });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const index = reviews.findIndex(r => r.id === id);
  if (index === -1) return res.status(404).json({ error: 'Review not found' });
  reviews.splice(index, 1);
  res.json({ success: true, message: 'Review deleted' });
});

module.exports = router;