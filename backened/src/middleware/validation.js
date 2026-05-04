// src/middleware/validation.js
const { body, param, query, validationResult } = require('express-validator');

// Validation rules
const validateBooking = [
  body('name').notEmpty().withMessage('Name is required').trim().isLength({ min: 2, max: 100 }),
  body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
  body('phone').notEmpty().withMessage('Phone is required').matches(/^(07|01|2547|2541)[0-9]{8}$/).withMessage('Valid Kenyan phone number required'),
  body('event_date').isISO8601().withMessage('Valid event date required'),
  body('event_type').notEmpty().withMessage('Event type required'),
  body('venue').optional().trim(),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

const validateEvent = [
  body('title').notEmpty().withMessage('Title required').trim().isLength({ min: 3, max: 200 }),
  body('event_date').isISO8601().withMessage('Valid date required'),
  body('venue').notEmpty().withMessage('Venue required'),
  body('price').isInt({ min: 0 }).withMessage('Valid price required'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

const validateService = [
  body('name').notEmpty().withMessage('Name required'),
  body('category').isIn(['Audio', 'Visual', 'Lighting', 'Media', 'Effects']),
  body('price').isInt({ min: 0 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

const validateReview = [
  body('client_name').notEmpty().withMessage('Client name required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5'),
  body('comment').notEmpty().withMessage('Comment required').isLength({ min: 10, max: 1000 }),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

module.exports = {
  validateBooking,
  validateEvent,
  validateService,
  validateReview
};