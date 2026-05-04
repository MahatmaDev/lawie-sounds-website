const { supabaseAdmin } = require('../../config/supabase');

async function getEvents(req, res) {
  try {
    let query = supabaseAdmin.from('events').select('*').order('event_date', { ascending: true });
    
    if (req.query.status === 'active') query = query.eq('is_active', true);
    if (req.query.status === 'inactive') query = query.eq('is_active', false);
    if (req.query.limit) query = query.limit(parseInt(req.query.limit));
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function createEvent(req, res) {
  try {
    const eventData = { ...req.body, created_at: new Date().toISOString() };
    const { data, error } = await supabaseAdmin.from('events').insert([eventData]).select().single();
    
    if (error) throw error;
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function updateEvent(req, res) {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updated_at: new Date().toISOString() };
    
    const { data, error } = await supabaseAdmin.from('events').update(updates).eq('id', id).select().single();
    
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Event not found' });
    
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function deleteEvent(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabaseAdmin.from('events').delete().eq('id', id);
    
    if (error) throw error;
    res.json({ success: true, message: 'Event deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function getEventStats(req, res) {
  try {
    const { data, error } = await supabaseAdmin.from('events').select('is_active');
    if (error) throw error;
    
    const stats = {
      total: data.length,
      active: data.filter(e => e.is_active).length,
      inactive: data.filter(e => !e.is_active).length
    };
    
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

module.exports = { getEvents, createEvent, updateEvent, deleteEvent, getEventStats };