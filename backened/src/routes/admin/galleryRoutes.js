const express = require('express');
const router = express.Router();

const gallery = [
  { id: '1', title: 'DJ Performance', category: 'Audio', imageUrl: 'https://images.unsplash.com/photo-1593642532973-d31b6557fa68' }
];

router.get('/', (req, res) => {
  res.json({ success: true, data: gallery });
});

router.post('/', (req, res) => {
  const newItem = { id: Date.now().toString(), ...req.body };
  gallery.push(newItem);
  res.status(201).json({ success: true, data: newItem });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const index = gallery.findIndex(i => i.id === id);
  if (index === -1) return res.status(404).json({ error: 'Image not found' });
  gallery.splice(index, 1);
  res.json({ success: true, message: 'Image deleted' });
});

module.exports = router;