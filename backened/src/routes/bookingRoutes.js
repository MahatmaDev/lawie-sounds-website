// src/routes/bookingRoutes.js
const express = require('express');
const router = express.Router();
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { validateBooking } = require('../middleware/validation');
const bookingController = require('../controllers/bookingController');

// Public routes
router.post('/', validateBooking, bookingController.createBooking);

// Admin only routes
router.get('/', verifyToken, requireAdmin, bookingController.getAllBookings);
router.get('/stats', verifyToken, requireAdmin, bookingController.getBookingStats);
router.get('/:id', verifyToken, requireAdmin, bookingController.getBooking);
router.put('/:id/status', verifyToken, requireAdmin, bookingController.updateBookingStatus);
router.delete('/:id', verifyToken, requireAdmin, bookingController.deleteBooking);

module.exports = router;