// src/controllers/serviceController.js
const { supabase, supabaseAdmin } = require('../config/supabase');
const { AppError } = require('../middleware/errorHandler');

// Get all services (public)
async function getAllServices(req, res, next) {
  try {
    let query = supabase
      .from('services')
      .select('*')
      .order('display_order', { ascending: true });
    
    // Filter by category
    if (req.query.category && req.query.category !== 'all') {
      query = query.eq('category', req.query.category);
    }
    
    // Filter by active only (default for public)
    if (req.query.active !== 'false') {
      query = query.eq('is_active', true);
    }
    
    // Limit results
    if (req.query.limit) {
      query = query.limit(parseInt(req.query.limit));
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    next(error);
  }
}

// Get single service by slug or id
async function getService(req, res, next) {
  try {
    const { id } = req.params;
    
    let query = supabase.from('services').select('*');
    
    // Check if id is UUID or slug
    if (id.includes('-') && id.length > 30) {
      query = query.eq('id', id);
    } else {
      query = query.eq('slug', id);
    }
    
    const { data, error } = await query.single();
    
    if (error || !data) {
      throw new AppError('Service not found', 404);
    }
    
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// Create service (admin only)
async function createService(req, res, next) {
  try {
    const serviceData = req.body;
    
    const { data, error } = await supabaseAdmin
      .from('services')
      .insert([serviceData])
      .select()
      .single();
    
    if (error) throw error;
    
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// Update service (admin only)
async function updateService(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;
    updates.updated_at = new Date().toISOString();
    
    const { data, error } = await supabaseAdmin
      .from('services')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    if (!data) throw new AppError('Service not found', 404);
    
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// Delete service (admin only)
async function deleteService(req, res, next) {
  try {
    const { id } = req.params;
    
    const { error } = await supabaseAdmin
      .from('services')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Service deleted successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllServices,
  getService,
  createService,
  updateService,
  deleteService
};