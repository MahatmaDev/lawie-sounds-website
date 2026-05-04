// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const { supabaseAdmin } = require('../../config/supabase');
const { generateToken } = require('../../middleware/auth');
const { AppError } = require('../../middleware/errorHandler');

// Admin login
async function login(req, res, next) {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      throw new AppError('Username and password required', 400);
    }
    
    // Find user in Supabase
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, username, email, role, password_hash')
      .eq('username', username)
      .single();
    
    if (error || !user) {
      throw new AppError('Invalid credentials', 401);
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      throw new AppError('Invalid credentials', 401);
    }
    
    // Update last login
    await supabaseAdmin
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);
    
    // Generate token
    const token = generateToken(user.id, user.email, user.role);
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
}

// Verify token
async function verify(req, res, next) {
  try {
    const user = await verifyUserFromDB(req.user.id);
    if (!user) {
      throw new AppError('User not found', 404);
    }
    res.json({ valid: true, user });
  } catch (error) {
    next(error);
  }
}

// Change password
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;
    
    // Get current user
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('password_hash')
      .eq('id', userId)
      .single();
    
    if (error || !user) {
      throw new AppError('User not found', 404);
    }
    
    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      throw new AppError('Current password is incorrect', 401);
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    
    // Update password
    await supabaseAdmin
      .from('users')
      .update({ password_hash: hashedPassword })
      .eq('id', userId);
    
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = { login, verify, changePassword };