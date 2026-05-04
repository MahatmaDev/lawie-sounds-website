// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');

// Verify JWT token
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }
  
  const token = authHeader.split(' ')[1];
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

// Check admin role
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Check manager or admin
function requireManager(req, res, next) {
  if (req.user.role !== 'admin' && req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Manager or admin access required' });
  }
  next();
}

// Generate JWT token
function generateToken(userId, email, role) {
  return jwt.sign(
    { id: userId, email, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// Verify user from database
async function verifyUserFromDB(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, email, role')
    .eq('id', userId)
    .single();
  
  if (error || !data) return null;
  return data;
}

module.exports = {
  verifyToken,
  requireAdmin,
  requireManager,
  generateToken,
  verifyUserFromDB
};