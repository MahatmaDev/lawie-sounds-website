// src/controllers/eventController.js
const { supabase, supabaseAdmin } = require('../config/supabase');
const { AppError } = require('../middleware/errorHandler');

// Get all events (public)
async function getAllEvents(req, res, next) {
  try {
    let query = supabase
      .from('events')
      .select('*')
      .order('event_date', { ascending: true });
    
    // Filter by upcoming only
    if (req.query.upcoming === 'true') {
      query = query.gte('event_date', new Date().toISOString().split('T')[0]);
    }
    
    // Filter by active only
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

// Get single event
async function getEvent(req, res, next) {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error || !data) {
      throw new AppError('Event not found', 404);
    }
    
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// Create event (admin only)
async function createEvent(req, res, next) {
  try {
    const eventData = req.body;
    
    const { data, error } = await supabaseAdmin
      .from('events')
      .insert([eventData])
      .select()
      .single();
    
    if (error) throw error;
    
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// Update event (admin only)
async function updateEvent(req, res, next) {
  try {
    const { id } = req.params;
    const updates = req.body;
    updates.updated_at = new Date().toISOString();
    
    const { data, error } = await supabaseAdmin
      .from('events')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    if (!data) throw new AppError('Event not found', 404);
    
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

// Delete event (admin only)
async function deleteEvent(req, res, next) {
  try {
    const { id } = req.params;
    
    const { error } = await supabaseAdmin
      .from('events')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAllEvents,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent
};