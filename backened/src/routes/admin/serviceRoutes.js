const express = require('express');
const router = express.Router();

const services = [
  { id: '1', name: 'DJ & MC Services', category: 'Audio', price: 25000, isActive: true },
  { id: '2', name: 'LED Screens', category: 'Visual', price: 15000, isActive: true }
];

router.get('/', (req, res) => {
  res.json({ success: true, data: services });
});

router.get('/:id', (req, res) => {
  const { id } = req.params;
  const service = services.find(s => s.id === id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  res.json({ success: true, data: service });
});

router.post('/', (req, res) => {
  const newService = { id: Date.now().toString(), ...req.body, isActive: true };
  services.push(newService);
  res.status(201).json({ success: true, data: newService });
});

router.put('/:id', (req, res) => {
  const { id } = req.params;
  const index = services.findIndex(s => s.id === id);
  if (index === -1) return res.status(404).json({ error: 'Service not found' });
  services[index] = { ...services[index], ...req.body };
  res.json({ success: true, data: services[index] });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const index = services.findIndex(s => s.id === id);
  if (index === -1) return res.status(404).json({ error: 'Service not found' });
  services.splice(index, 1);
  res.json({ success: true, message: 'Service deleted' });
});

module.exports = router;