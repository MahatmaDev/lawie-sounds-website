// src/middleware/rateLimit.js
const rateLimit = require('express-rate-limit');

// Strict limiter for authentication
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many login attempts, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
});

// Booking submission limiter
const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 bookings per hour per IP
  message: 'Too many booking submissions. Please try again later.',
});

// API limiter for public endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: 'Too many requests, please slow down',
});

module.exports = {
  authLimiter,
  bookingLimiter,
  apiLimiter
};